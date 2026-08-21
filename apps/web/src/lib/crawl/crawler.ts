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

export function setRequestGap(ms: number) {
  requestGapMs = Math.max(0, ms);
}

/** Widen the gap when a host pushes back; it never narrows within a crawl. */
function widenRequestGap() {
  requestGapMs = Math.min(requestGapMs * 2, 30_000);
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
  let applies = false;
  let crawlDelayMs: number | undefined;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
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
  return allow;
}

type RobotsRules = ((url: URL) => boolean) & { crawlDelayMs?: number };

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

async function discoverSitemap(
  root: URL,
  fetchPublic: SafeFetcher,
  maximumUrls: number,
) {
  const queue = [
    new URL("/sitemap.xml", root),
    new URL("/sitemap_index.xml", root),
  ];
  const visited = new Set<string>();
  const urls = new Set<string>();
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
  return [...urls];
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

export async function crawlWebsite({
  url: input,
  pageLimit,
  includePaths = [],
  excludePaths = [],
  trustedInternal = false,
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

  const sitemapUrls = await discoverSitemap(
    root,
    fetchPublic,
    limit * 8,
  );
  const queue = [
    root.href,
    ...sitemapUrls.filter((item) => item !== root.href),
  ];
  const queued = new Set(queue);
  const pages: ExtractedPage[] = [];
  const failures: Array<{ url: string; reason: string }> = [];
  const contentHashes = new Set<string>();
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
          if (needsBrowserRendering(html, page.text)) {
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
            next.origin === root.origin &&
            !queued.has(next.href) &&
            allowedByRobots(next) &&
            matchesPath(next, includePaths, excludePaths)
          ) {
            queued.add(next.href);
            queue.push(next.href);
          }
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
