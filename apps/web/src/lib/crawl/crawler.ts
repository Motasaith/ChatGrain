import { AppError } from "@/lib/http/errors";
import { logger } from "@/lib/observability/logger";
import {
  createSafeFetcher,
  validatePublicUrl,
  type SafeFetcher,
} from "@/lib/security/public-url";
import {
  createBrowserRenderer,
  needsBrowserRendering,
} from "./browser-renderer";
import {
  extractBrand,
  extractPage,
  isSoftNotFound,
  type ExtractedPage,
  type SiteBrand,
} from "./extract";
import { systemCrawlPageLimit } from "@/lib/usage/limits";

export type CrawlOptions = {
  url: string;
  pageLimit: number;
  includePaths?: string[];
  excludePaths?: string[];
  trustedInternal?: boolean;
  /**
   * URLs already known for this source, used to seed the queue.
   *
   * A crawl that has been interrupted otherwise has to rediscover the whole
   * site by walking links from the root before it reaches the part it had not
   * finished. The saved inventory is last run's frontier, so handing it back
   * turns that walk into a starting position.
   */
  seedUrls?: string[];
  /**
   * URLs an earlier attempt of the same job already fetched. Not requested
   * again, and not counted against the page limit, because they are already
   * indexed.
   */
  skipUrls?: Set<string>;
  /**
   * URLs the operator has excluded. Never fetched, and never followed - a page
   * turned off should not keep feeding the queue through its own links.
   */
  blockedUrls?: Set<string>;
  /**
   * Whether links found on a page may be added to the queue.
   *
   * False once a list of URLs has been approved. The approved list is the job;
   * discovering more mid-run would mean crawling pages nobody agreed to, and
   * would make the total climb while someone is watching it - which is the
   * thing the review step exists to stop. Links are still collected and
   * returned as `newUrls`, so the next review can offer them.
   */
  followLinks?: boolean;
  /** Browser rendering policy: detect, force, or never. */
  renderJs?: "auto" | "always" | "never";
  onProgress?: (progress: {
    discovered: number;
    processed: number;
  }) => Promise<void> | void;
  /**
   * Reports the outcome of every URL the crawler touches. Pages that are
   * dropped for being thin or duplicate used to disappear silently, which made
   * "it found fewer pages than my site has" impossible to explain.
   */
  onPage?: (event: CrawlPageEvent) => void;
};

export type CrawlPageOutcome =
  /** Extracted and queued for indexing. */
  | "indexed"
  /** Identical content already seen at another URL this run. */
  | "duplicate"
  /** Too little text to be worth indexing. */
  | "thin"
  /**
   * Sent us to another URL. Recorded so the totals reconcile: outcomes are
   * keyed by the final URL, so without this a redirected URL is tried but
   * never accounted for.
   */
  | "redirected"
  /** Fetch, render, or extraction failed. */
  | "failed"
  /**
   * The host refused us rather than the page being broken. Kept distinct from
   * `failed` because the customer-facing fix is completely different: a blocked
   * page is a firewall conversation, a failed one is a bad URL.
   */
  | "blocked";

export type CrawlPageEvent = {
  url: string;
  outcome: CrawlPageOutcome;
  title?: string;
  reason?: string;
};

export type CrawlResult = {
  rootUrl: string;
  brand: SiteBrand;
  pages: ExtractedPage[];
  failures: Array<{ url: string; reason: string }>;
  /**
   * URLs found and tried. Distinct from `pages.length`, which counts only what
   * was kept: duplicates, thin pages and redirects are all discovered without
   * becoming a page.
   */
  discovered: number;
  /** The circuit breaker ended the run, rather than the queue emptying. */
  stoppedEarly: boolean;
  /** A page was read well enough to identify the site, rather than guessed. */
  brandDetected: boolean;
  /** Every in-scope URL this run queued, for the review list. */
  discoveredUrls: string[];
  /**
   * In-scope URLs seen on crawled pages that were not part of this run.
   *
   * Only populated when `followLinks` is false, where they are the pages the
   * site has grown since the list was approved. Recorded rather than crawled,
   * so they can be offered at the next review instead of silently appearing.
   */
  newUrls: string[];
};

/**
 * Parallel fetches per batch. Documented in `.env.example` but previously
 * hardcoded, so tuning it had no effect. Capped to keep a crawl from
 * overwhelming a small VPS or the site being indexed.
 */
/**
 * Statuses that mean "you are going too fast", not "this page is broken".
 *
 * 403 belongs here even though it reads like a permission error. A WordPress
 * security plugin that decides you are crawling too hard does not answer 429
 * once and relent - it blocks the IP and answers 403 to everything after that.
 * Treating those as ordinary page failures meant the crawler kept firing at
 * full concurrency into a live block, which is what kept the block alive: a
 * 7,000 page site returned 40 pages and ~6,900 identical 403s.
 */
const BACKPRESSURE_STATUSES = new Set([403, 429, 503, 509]);

/**
 * Ceiling on one `Retry-After`.
 *
 * Wordfence-style blocks routinely last five minutes, so the old 30 second cap
 * guaranteed every retry landed inside the same block. Waiting once for the
 * real duration costs less than failing every remaining URL.
 */
const MAX_BACKPRESSURE_MS = 300_000;

/**
 * Consecutive failures before a crawl gives up on the host entirely.
 *
 * Once a site is blocking us, every further request is both useless and more
 * evidence to whatever is doing the blocking. Stopping at 20 turns an hour of
 * hammering into a report the customer can act on.
 */
const CIRCUIT_BREAKER_FAILURES = 20;

/**
 * Politeness floor: the smallest gap between two requests to the same host.
 *
 * Concurrency alone is not a rate limit. Six workers with no delay is a burst
 * of roughly 100-300 requests/minute, and the common security-plugin default
 * trips at about 120. One request per second stays under every default we know
 * of, and `Crawl-delay` raises it further when the site asks.
 */
const DEFAULT_MIN_REQUEST_GAP_MS = 1_000;

/**
 * Paths that belong to the software running a site, never to the site itself.
 *
 * /cdn-cgi/ is the one that forced this list. It is Cloudflare's own namespace,
 * and its content endpoint mints a fresh random id on every render - so each
 * response is a URL never seen before, carrying decoy text written to catch
 * bots. A crawl of a Cloudflare-fronted site therefore finds an unlimited
 * supply of unique pages that are not the site, indexes them as real content,
 * and never converges. Observed on pic-microcontroller.com, where a knowledge
 * base about PIC microcontrollers acquired an article on meiosis.
 *
 * The rest are the WordPress machinery: an API, an RPC endpoint and a login
 * form. None of them is prose, and all of them are linked from ordinary pages.
 *
 * Matched on the path only, so a page that merely mentions one of these strings
 * in a query parameter is unaffected.
 */
const INFRASTRUCTURE_PATHS = [
  "/cdn-cgi/",
  "/wp-json/",
  "/wp-admin/",
  "/wp-login.php",
  "/xmlrpc.php",
];

/**
 * Whether a URL is site infrastructure rather than site content.
 *
 * Separate from the operator's exclude patterns on purpose: those express a
 * judgement about one site, and this is true of every site.
 */
export function isInfrastructureUrl(url: URL) {
  const path = url.pathname.toLowerCase();
  return INFRASTRUCTURE_PATHS.some((segment) => path.includes(segment));
}

/** The same test for a URL that has not been parsed yet. */
export function isInfrastructureHref(href: string) {
  try {
    return isInfrastructureUrl(new URL(href));
  } catch {
    // Unparseable is not infrastructure; it fails later, where the error is
    // reported against the page rather than silently dropped here.
    return false;
  }
}

/**
 * Shared pause across the whole batch.
 *
 * Every page in a batch is fetched concurrently, so one worker backing off
 * achieves nothing while five others keep hammering. Holding the pause here
 * means a single 429 slows the entire crawl, which is what the remote server
 * is actually asking for. The worker runs one job at a time, so module scope is
 * the right lifetime.
 */
let backpressureUntil = 0;

export function applyBackpressure(retryAfterHeader: string | null) {
  const waitMs = parseRetryAfter(retryAfterHeader) ?? 5_000;
  backpressureUntil = Math.max(backpressureUntil, Date.now() + waitMs);
}

/**
 * `Retry-After` is either a delay in seconds or an HTTP date. Only the first
 * form was understood, so a server answering with a date got the 5 second
 * default and was retried far too early.
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1_000, MAX_BACKPRESSURE_MS);
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    const delta = date - Date.now();
    if (delta > 0) return Math.min(delta, MAX_BACKPRESSURE_MS);
  }
  return undefined;
}

async function waitOutBackpressure() {
  const remaining = backpressureUntil - Date.now();
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, remaining));
}

/**
 * Spaces requests to one host, so concurrency stops being the only limit.
 *
 * Every fetch takes a turn here before it goes out. The gap starts at the
 * politeness floor, and widens on its own whenever the host pushes back, so a
 * site that dislikes our pace slows us down without anyone tuning anything.
 */
let nextRequestAt = 0;
let requestGapMs = DEFAULT_MIN_REQUEST_GAP_MS;
/**
 * The politeness floor for this crawl. Recovery stops here rather than at zero,
 * because it is the larger of our own floor and whatever `Crawl-delay` the site
 * published - and a site's declared delay is not something to back away from
 * just because it has been quiet for a while.
 */
let requestGapFloorMs = DEFAULT_MIN_REQUEST_GAP_MS;
/** Consecutive fetches since the last time the host pushed back. */
let cleanRequests = 0;

/**
 * How many uninterrupted successes buy one halving of the gap.
 *
 * Deliberately asymmetric with widening, which happens on a single 429. Backing
 * off fast and returning slowly is the safe direction to be wrong in: guessing
 * high costs time, guessing low costs the crawl.
 */
export const GAP_RECOVERY_SUCCESSES = 20;

/**
 * The gap and the clean-run counter after one more successful fetch.
 *
 * Pure, so the recovery curve can be pinned down without a network or a clock.
 * Halving rather than stepping back to the floor: the host objected once, and
 * returning immediately to the pace that caused it would just earn another 429.
 */
export function recoveredGap(
  current: number,
  floor: number,
  cleanRun: number,
): { gap: number; cleanRun: number } {
  if (current <= floor) return { gap: current, cleanRun: 0 };
  const next = cleanRun + 1;
  if (next < GAP_RECOVERY_SUCCESSES) return { gap: current, cleanRun: next };
  return { gap: Math.max(floor, Math.round(current / 2)), cleanRun: 0 };
}

export function setRequestGap(ms: number) {
  requestGapMs = Math.max(0, ms);
  requestGapFloorMs = requestGapMs;
  cleanRequests = 0;
}

/** Widen the gap when a host pushes back. */
function widenRequestGap() {
  requestGapMs = Math.min(requestGapMs * 2, 30_000);
  cleanRequests = 0;
}

/**
 * Narrow the gap back toward the floor after a sustained clean run.
 *
 * This used to not exist, and the comment where it should have been said so:
 * "it never narrows within a crawl". The effect was that one bad minute early
 * on set the pace for everything after it. A crawl that met a brief rate limit
 * in its first hundred pages doubled its way to the thirty-second ceiling and
 * stayed there - two requests a minute - for the rest of the run. A 17,000-URL
 * site was observed still crawling after 48 hours for exactly this reason,
 * diagnosed for a week as a memory problem it was not.
 */
function narrowRequestGap() {
  const next = recoveredGap(requestGapMs, requestGapFloorMs, cleanRequests);
  requestGapMs = next.gap;
  cleanRequests = next.cleanRun;
}

async function takeRequestSlot() {
  if (requestGapMs <= 0) return;
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt);
  // Jitter breaks up the perfectly even spacing that looks automated to a
  // rate limiter counting requests per fixed window.
  nextRequestAt = slot + requestGapMs + Math.random() * requestGapMs * 0.3;
  const wait = slot - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/** Test seam: crawls are sequential, but each one starts unthrottled. */
export function resetBackpressure() {
  backpressureUntil = 0;
  nextRequestAt = 0;
  requestGapMs = DEFAULT_MIN_REQUEST_GAP_MS;
  requestGapFloorMs = DEFAULT_MIN_REQUEST_GAP_MS;
  cleanRequests = 0;
}

function crawlConcurrency() {
  const configured = Number(process.env.CRAWL_CONCURRENCY?.trim());
  if (!Number.isFinite(configured) || configured < 1) return 6;
  return Math.min(24, Math.floor(configured));
}

const ignoredExtension =
  /\.(?:jpe?g|png|gif|webp|avif|svg|ico|pdf|zip|gz|rar|mp4|mp3|mov|avi|webm|woff2?|ttf|eot|css|js|xml)$/i;
const ignoredRoute =
  /\/(?:login|logout|sign-?in|sign-?up|register|cart|checkout|account|wp-admin)(?:\/|$)/i;

export function parseRobots(content: string) {
  const disallowed: string[] = [];
  const sitemaps: string[] = [];
  let applies = false;
  let crawlDelayMs: number | undefined;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    // Sitemap lines are global: they are not scoped to a user-agent group, so
    // they are read whether or not the current group applies to us. This is the
    // site telling us where its own index of itself lives, which beats guessing
    // at conventional paths.
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      // Must match the name we actually send in `public-url.ts`. This read
      // `docentbot` long after the agent string became ChatGrainBot, so any
      // site writing rules for us by name was silently ignored.
      applies = value === "*" || /chatgrainbot/i.test(value);
    } else if (applies && key === "disallow" && value) {
      disallowed.push(value);
    } else if (applies && key === "crawl-delay") {
      // Widely published by WordPress security plugins, and obeying it is both
      // polite and the cheapest way to never meet their rate limiter.
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) {
        crawlDelayMs = Math.min(seconds * 1_000, 30_000);
      }
    }
  }
  const allow = (url: URL) =>
    !disallowed.some((path) => url.pathname.startsWith(path));
  allow.crawlDelayMs = crawlDelayMs;
  allow.sitemaps = sitemaps;
  return allow;
}

type RobotsRules = ((url: URL) => boolean) & {
  crawlDelayMs?: number;
  /** Sitemaps the site declared. The authoritative answer, when it exists. */
  sitemaps?: string[];
};

async function loadRobots(
  origin: string,
  fetchPublic: SafeFetcher,
): Promise<RobotsRules> {
  const permitAll: RobotsRules = () => true;
  try {
    const { response } = await fetchPublic(new URL("/robots.txt", origin), {
      timeoutMs: 5_000,
      maxBytes: 500_000,
      headers: { accept: "text/plain" },
    });
    if (!response.ok) return permitAll;
    return parseRobots(await response.text());
  } catch {
    return permitAll;
  }
}

/**
 * Paths worth guessing when a site does not say where its sitemap is.
 *
 * Guessing is the last resort and these are ordered by how often they are
 * right. /sitemap.xml is the convention; /wp-sitemap.xml is what WordPress 5.5
 * and later generate by default, which covers a large share of the web on its
 * own; the rest are what the common SEO plugins produce.
 */
const SITEMAP_GUESSES = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/wp-sitemap.xml",
  "/sitemap-index.xml",
  "/sitemap/sitemap.xml",
  "/sitemap1.xml",
];

async function discoverSitemap(
  root: URL,
  fetchPublic: SafeFetcher,
  maximumUrls: number,
  candidates: string[] = [],
) {
  const queue: URL[] = [];
  for (const href of candidates) {
    try {
      queue.push(new URL(href, root));
    } catch {
      // A malformed Sitemap: line is the site's problem, not a reason to stop.
    }
  }
  for (const path of SITEMAP_GUESSES) queue.push(new URL(path, root));
  const visited = new Set<string>();
  const urls = new Set<string>();
  let foundAt: string | null = null;
  while (
    queue.length &&
    visited.size < 100 &&
    urls.size < maximumUrls
  ) {
    const candidate = queue.shift()!;
    if (visited.has(candidate.href)) continue;
    visited.add(candidate.href);
    try {
      const { response } = await fetchPublic(candidate, {
        timeoutMs: 8_000,
        maxBytes: 5_000_000,
        headers: { accept: "application/xml,text/xml" },
      });
      if (!response.ok) continue;
      const xml = await response.text();
      // The first candidate that answers with a real sitemap is the one worth
      // telling the operator about; the rest were guesses that missed.
      if (!foundAt && /<(?:urlset|sitemapindex)(?:\s|>)/i.test(xml)) {
        foundAt = candidate.href;
      }
      const sitemapIndex = /<sitemapindex(?:\s|>)/i.test(xml);
      for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
        const value = match[1]
          .replaceAll("&amp;", "&")
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">");
        try {
          const url = new URL(value);
          if (url.origin !== root.origin) continue;
          if (
            sitemapIndex ||
            /\.(?:xml|xml\.gz)(?:$|\?)/i.test(url.pathname)
          ) {
            if (!visited.has(url.href)) queue.push(url);
          } else {
            urls.add(url.href);
            if (urls.size >= maximumUrls) break;
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return { urls: [...urls], foundAt };
}

function matchesPath(
  url: URL,
  includePaths: string[],
  excludePaths: string[],
) {
  if (
    ignoredExtension.test(url.pathname) ||
    ignoredRoute.test(url.pathname)
  ) {
    return false;
  }
  if (
    includePaths.length &&
    !includePaths.some((path) => url.pathname.startsWith(path))
  ) {
    return false;
  }
  if (excludePaths.some((path) => url.pathname.startsWith(path))) {
    return false;
  }
  return true;
}

async function fetchHtml(
  url: URL,
  fetchPublic: SafeFetcher,
  retries = 3,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await waitOutBackpressure();
    await takeRequestSlot();
    try {
      const { response, finalUrl } = await fetchPublic(url, {
        timeoutMs: 15_000,
        maxBytes: 3_000_000,
      });
      if (!response.ok) {
        if (BACKPRESSURE_STATUSES.has(response.status)) {
          // The site is asking us to slow down. Retrying in a few hundred
          // milliseconds - and continuing to hammer it from every other worker
          // in the batch - turns a brief limit into a whole failed crawl.
          applyBackpressure(response.headers.get("retry-after"));
          // Pushback is also the signal to crawl this host more slowly for the
          // rest of the run, not just to pause once.
          widenRequestGap();
          throw new AppError(
            "CRAWL_RATE_LIMITED",
            `Remote server is refusing requests (HTTP ${response.status}), ` +
              "which usually means a rate limit or a security plugin block.",
            503,
          );
        }
        throw new AppError(
          "CRAWL_HTTP_ERROR",
          `Remote server returned HTTP ${response.status}.`,
          502,
        );
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
        throw new AppError(
          "UNSUPPORTED_CONTENT",
          `Unsupported content type: ${contentType || "unknown"}.`,
          415,
        );
      }
      // A clean fetch is the evidence that the host is no longer objecting, so
      // it is what pays down the backoff.
      narrowRequestGap();
      return { html: await response.text(), finalUrl };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * 2 ** attempt),
        );
      }
    }
  }
  throw lastError;
}

/**
 * The starting queue, and the set of URLs that must never enter it.
 *
 * Pure, and separate from the crawl, because this is where resume and
 * exclusion actually happen and both need to be provable without a network.
 *
 * Order is root, then sitemap, then the saved inventory: a crawl with no
 * inventory behaves exactly as it always did, and seeds only ever add reach
 * rather than displacing the site's own structure.
 *
 * Skipped and blocked URLs are put into `queued` before anything else is
 * considered. That set does double duty - it is also what stops a URL being
 * enqueued twice - so seeding it first means an excluded URL is refused
 * whether it arrives from the sitemap, from the inventory, or from a link on
 * a page crawled later.
 */
export function buildCrawlQueue({
  rootHref,
  sitemapUrls = [],
  seedUrls = [],
  skipUrls = new Set<string>(),
  blockedUrls = new Set<string>(),
}: {
  rootHref: string;
  sitemapUrls?: string[];
  seedUrls?: string[];
  skipUrls?: Set<string>;
  blockedUrls?: Set<string>;
}) {
  const queue: string[] = [];
  const queued = new Set<string>([...skipUrls, ...blockedUrls]);
  for (const href of [rootHref, ...sitemapUrls, ...seedUrls]) {
    if (queued.has(href)) continue;
    // Infrastructure can reach the queue from a sitemap or from an inventory
    // saved before this rule existed, not only from a link on a page.
    if (href !== rootHref && isInfrastructureHref(href)) continue;
    queued.add(href);
    queue.push(href);
  }
  return { queue, queued };
}

export async function crawlWebsite({
  url: input,
  pageLimit,
  includePaths = [],
  excludePaths = [],
  trustedInternal = false,
  seedUrls = [],
  skipUrls = new Set<string>(),
  blockedUrls = new Set<string>(),
  followLinks = true,
  renderJs = "auto",
  onProgress,
  onPage,
}: CrawlOptions): Promise<CrawlResult> {
  const root = await validatePublicUrl(input, {
    allowPrivate: trustedInternal,
  });
  const limit = Math.max(1, Math.min(systemCrawlPageLimit(), pageLimit));
  const fetchPublic = createSafeFetcher({
    allowPrivate: trustedInternal,
  });
  const browserRenderer = createBrowserRenderer({
    allowPrivate: trustedInternal,
  });
  const allowedByRobots = await loadRobots(root.origin, fetchPublic);
  if (!allowedByRobots(root)) {
    throw new AppError(
      "ROBOTS_BLOCKED",
      "The website's robots.txt does not allow this page to be crawled.",
      403,
    );
  }
  // A published Crawl-delay is the site telling us its comfortable speed. Take
  // it over our own floor whenever it is slower.
  setRequestGap(
    Math.max(DEFAULT_MIN_REQUEST_GAP_MS, allowedByRobots.crawlDelayMs ?? 0),
  );

  const sitemap = await discoverSitemap(
    root,
    fetchPublic,
    limit * 8,
    allowedByRobots.sitemaps ?? [],
  );
  const sitemapUrls = sitemap.urls;
  const { queue, queued } = buildCrawlQueue({
    rootHref: root.href,
    sitemapUrls,
    seedUrls,
    skipUrls,
    blockedUrls,
  });
  const pages: ExtractedPage[] = [];
  const failures: Array<{ url: string; reason: string }> = [];
  const contentHashes = new Set<string>();
  /** In-scope links seen but deliberately not crawled. See `followLinks`. */
  const newUrls = new Set<string>();
  let brand: SiteBrand | undefined;
  let processed = 0;
  /** Reset by any success; only an unbroken run of failures trips the breaker. */
  let consecutiveFailures = 0;
  /** How many of those failures were the host actively refusing us. */
  let blockedCount = 0;
  let stoppedEarly = false;

  try {
    while (queue.length && pages.length < limit) {
      const batch = queue.splice(
        0,
        Math.min(crawlConcurrency(), limit - pages.length),
      );
      const results = await Promise.allSettled(
        batch.map(async (value) => {
          const requestedUrl = new URL(value);
          if (
            requestedUrl.origin !== root.origin ||
            blockedUrls.has(requestedUrl.href) ||
            isInfrastructureUrl(requestedUrl) ||
            !allowedByRobots(requestedUrl) ||
            !matchesPath(requestedUrl, includePaths, excludePaths)
          ) {
            return null;
          }
          const fetched = await fetchHtml(requestedUrl, fetchPublic);
          let html = fetched.html;
          let finalUrl = fetched.finalUrl;
          // The filters above ran on the URL we asked for. A redirect can land
          // somewhere they would have rejected - observed live on chatgrain.com,
          // where /dashboard 302s to /sign-in and the login page was indexed as
          // though it were site content. Re-check where we actually arrived.
          const landedUrl = new URL(finalUrl);
          if (
            landedUrl.origin !== root.origin ||
            !allowedByRobots(landedUrl) ||
            !matchesPath(landedUrl, includePaths, excludePaths)
          ) {
            throw new AppError(
              "REDIRECTED_AWAY",
              `Redirected to an excluded location (${landedUrl.pathname}).`,
              422,
            );
          }
          if (isSoftNotFound(html)) {
            throw new AppError(
              "PAGE_NOT_FOUND",
              "The sitemap URL resolves to a not-found page.",
              404,
            );
          }
          let page = extractPage(html, finalUrl);
          if (needsBrowserRendering(html, page.text, renderJs)) {
            const rendered = await browserRenderer.render(finalUrl);
            html = rendered.html;
            finalUrl = rendered.finalUrl;
            page = extractPage(html, finalUrl);
          }
          return {
            page,
            brand: extractBrand(html, finalUrl),
          };
        }),
      );

      for (let index = 0; index < results.length; index += 1) {
        processed += 1;
        const result = results[index];
        if (result.status === "rejected") {
          const reason =
            result.reason instanceof Error
              ? result.reason.message
              : "Unknown crawl error";
          consecutiveFailures += 1;
          if (
            result.reason instanceof AppError &&
            result.reason.code === "CRAWL_RATE_LIMITED"
          ) {
            blockedCount += 1;
          }
          failures.push({ url: batch[index], reason });
          onPage?.({
            url: batch[index],
            outcome: blockedCount > 0 ? "blocked" : "failed",
            reason,
          });
          continue;
        }
        consecutiveFailures = 0;
        if (!result.value) {
          onPage?.({
            url: batch[index],
            outcome: "failed",
            reason: "The page returned no usable response.",
          });
          continue;
        }
        const { page, brand: pageBrand } = result.value;
        brand ??= pageBrand;
        // Outcomes below are recorded against the page's final URL, so a URL
        // that redirected would otherwise leave no trace and the totals would
        // not add up to the number of URLs tried. Recording the redirect makes
        // every processed URL account for itself.
        if (page.url !== batch[index]) {
          onPage?.({
            url: batch[index],
            outcome: "redirected",
            title: page.title,
            reason: `Redirected to ${page.url}`,
          });
        }
        if (page.text.length < 120) {
          onPage?.({
            url: page.url,
            outcome: "thin",
            title: page.title,
            reason: `Only ${page.text.length} characters of text were extracted.`,
          });
        } else if (contentHashes.has(page.contentHash)) {
          onPage?.({
            url: page.url,
            outcome: "duplicate",
            title: page.title,
            reason: "Identical content was already indexed from another URL.",
          });
        } else {
          contentHashes.add(page.contentHash);
          pages.push(page);
          onPage?.({ url: page.url, outcome: "indexed", title: page.title });
        }
        for (const link of page.links) {
          if (queued.size >= limit * 8) break;
          const next = new URL(link);
          if (
            next.origin !== root.origin ||
            queued.has(next.href) ||
            blockedUrls.has(next.href) ||
            isInfrastructureUrl(next) ||
            !allowedByRobots(next) ||
            !matchesPath(next, includePaths, excludePaths)
          ) {
            continue;
          }
          if (!followLinks) {
            // Noted for the next review, not crawled now. Capped so a site that
            // links to thousands of unseen pages cannot grow this without
            // bound between one review and the next.
            if (newUrls.size < 10_000) newUrls.add(next.href);
            continue;
          }
          queued.add(next.href);
          queue.push(next.href);
        }
        // Links have served their purpose once the queue is extended, and
        // indexing never reads them. Holding tens of thousands of URL strings
        // for the whole run is pure overhead on a large site.
        page.links = [];
      }
      await onProgress?.({
        discovered: queued.size,
        processed,
      });

      // Once a host is refusing us, every further request is useless and is
      // more evidence for whatever is doing the refusing. Stop and report.
      if (consecutiveFailures >= CIRCUIT_BREAKER_FAILURES) {
        stoppedEarly = true;
        break;
      }
    }

    if (!pages.length) {
      throw new AppError(
        blockedCount > 0 ? "CRAWL_BLOCKED" : "NO_CONTENT_FOUND",
        blockedCount > 0
          ? "This website blocked the crawler before any page could be read. " +
            "That is usually a firewall or security plugin rather than a broken site. " +
            "Ask the site owner to allow the ChatGrainBot user agent, or retry later."
          : "No useful public text could be extracted from this website.",
        blockedCount > 0 ? 403 : 422,
        { failures: failures.slice(0, 10) },
      );
    }

    if (stoppedEarly) {
      logger.warn(
        {
          rootUrl: root.href,
          indexed: pages.length,
          consecutiveFailures,
          blockedCount,
        },
        blockedCount > 0
          ? "Crawl stopped early: the site started refusing requests"
          : "Crawl stopped early after repeated failures",
      );
    }

    return {
      rootUrl: root.href,
      discovered: queued.size,
      /**
       * True when the circuit breaker ended the run rather than the queue
       * emptying. The caller needs it: this used to be a log line only, so a
       * crawl that gave up reported a clean success over a partial site.
       */
      stoppedEarly,
      /** Whether any page was read well enough to identify the site. */
      brandDetected: Boolean(brand),
      discoveredUrls: [...queued],
      newUrls: [...newUrls],
      brand: brand ?? {
        name: root.hostname.replace(/^www\./, ""),
        iconUrl: new URL("/favicon.ico", root).href,
        primaryColor: "#177e51",
      },
      pages,
      failures,
    };
  } finally {
    await browserRenderer.close();
  }
}
/**
 * Everything the site says it has, without indexing any of it.
 *
 * The first half of a reviewed crawl: find the URLs, show them to whoever asked
 * for the crawl, and index only what they approve. Splitting it this way is
 * what stops the page count climbing while someone watches it, and it is the
 * only point at which excluding a page is cheap - after indexing, the work is
 * already paid for.
 *
 * Sitemaps first, and usually last. A site that publishes one is telling us
 * exactly which pages it considers real, which is both faster and better than
 * anything link-walking infers: pic-microcontroller.com lists 6,428 pages
 * across a ten-part sitemap index and answers in under a minute, while walking
 * its links for 48 hours had reached 17,447 URLs and was still climbing,
 * because tag archives and Cloudflare decoys link to each other endlessly.
 *
 * Link-walking is the fallback for sites with no sitemap, and it costs a fetch
 * per page. That is the price of the guarantee, and it is still far cheaper
 * than embedding: fetching is a sub-second request, embedding is a model call
 * per chunk.
 */
/**
 * How the URL list was obtained, in descending order of how much the site told
 * us and ascending order of how much we guessed.
 *
 * Surfaced to the operator rather than kept internal. "We found 6,428 pages"
 * and "we found 12 pages by following links because your sitemap is behind a
 * firewall" call for completely different reactions, and only one of them is
 * visible without being told.
 */
export type SitemapMethod = "provided" | "declared" | "guessed" | "links";

export async function discoverSiteUrls({
  url: input,
  pageLimit,
  includePaths = [],
  excludePaths = [],
  trustedInternal = false,
  sitemapUrl,
  onProgress,
}: {
  url: string;
  pageLimit: number;
  includePaths?: string[];
  excludePaths?: string[];
  trustedInternal?: boolean;
  /** A sitemap the operator supplied, tried before anything is guessed. */
  sitemapUrl?: string | null;
  onProgress?: (progress: {
    discovered: number;
    processed: number;
  }) => Promise<void> | void;
}): Promise<{
  rootUrl: string;
  urls: string[];
  /** Whether the list came from the site's own sitemap or from walking links. */
  fromSitemap: boolean;
  /** Which of the strategies produced the list. */
  method: SitemapMethod;
  /** The sitemap that answered, if one did. */
  sitemapUrl: string | null;
  /** Sitemaps robots.txt named, whether or not they could be read. */
  declaredSitemaps: string[];
  /** The list hit `pageLimit` and is not the whole site. */
  truncated: boolean;
}> {
  const root = await validatePublicUrl(input, { allowPrivate: trustedInternal });
  const limit = Math.max(1, Math.min(systemCrawlPageLimit(), pageLimit));
  const fetchPublic = createSafeFetcher({ allowPrivate: trustedInternal });

  const allowedByRobots = await loadRobots(root.origin, fetchPublic);
  const allowed = (candidate: URL) =>
    candidate.origin === root.origin &&
    !isInfrastructureUrl(candidate) &&
    allowedByRobots(candidate) &&
    matchesPath(candidate, includePaths, excludePaths);

  // Ordered by how much the site is telling us versus how much we are guessing:
  // a sitemap the operator supplied, then one the site declared in robots.txt,
  // then the conventional paths. Asked for one over the limit, so "there is
  // more than you asked for" can be reported rather than inferred from an
  // exactly-full list.
  const declared = allowedByRobots.sitemaps ?? [];
  const candidates = [
    ...(sitemapUrl ? [sitemapUrl] : []),
    ...declared,
  ];
  const sitemap = await discoverSitemap(
    root,
    fetchPublic,
    limit + 1,
    candidates,
  );
  const sitemapUrls = sitemap.urls.filter((href) => {
    try {
      return allowed(new URL(href));
    } catch {
      return false;
    }
  });
  await onProgress?.({ discovered: sitemapUrls.length, processed: 0 });

  const method: SitemapMethod =
    sitemap.foundAt && sitemapUrl && sitemap.foundAt === new URL(sitemapUrl, root).href
      ? "provided"
      : sitemap.foundAt && declared.some((href) => {
            try {
              return new URL(href, root).href === sitemap.foundAt;
            } catch {
              return false;
            }
          })
        ? "declared"
        : "guessed";

  if (sitemapUrls.length > 1) {
    const urls = [root.href, ...sitemapUrls.filter((href) => href !== root.href)];
    return {
      rootUrl: root.href,
      urls: urls.slice(0, limit),
      fromSitemap: true,
      method,
      sitemapUrl: sitemap.foundAt,
      declaredSitemaps: declared,
      truncated: urls.length > limit,
    };
  }

  // No usable sitemap. Walk the links, which means fetching pages - but nothing
  // is extracted for keeps and nothing is embedded, so this is the cheap half
  // of a crawl rather than a whole one.
  const walked = await crawlWebsite({
    url: input,
    pageLimit: limit,
    includePaths,
    excludePaths,
    trustedInternal,
    onProgress,
  });
  const urls = walked.discoveredUrls.filter((href) => {
    try {
      return allowed(new URL(href));
    } catch {
      return false;
    }
  });
  return {
    rootUrl: root.href,
    urls: urls.slice(0, limit),
    fromSitemap: false,
    method: "links",
    sitemapUrl: null,
    declaredSitemaps: declared,
    truncated: urls.length > limit || walked.stoppedEarly,
  };
}
