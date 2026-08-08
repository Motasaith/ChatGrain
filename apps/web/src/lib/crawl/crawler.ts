import { AppError } from "@/lib/http/errors";
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
  /** Fetch, render, or extraction failed. */
  | "failed";

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
};

/**
 * Parallel fetches per batch. Documented in `.env.example` but previously
 * hardcoded, so tuning it had no effect. Capped to keep a crawl from
 * overwhelming a small VPS or the site being indexed.
 */
/** Statuses that mean "you are going too fast", not "this page is broken". */
const BACKPRESSURE_STATUSES = new Set([429, 503]);

/** Never stall a whole crawl on one hostile `Retry-After`. */
const MAX_BACKPRESSURE_MS = 30_000;

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
  const seconds = Number(retryAfterHeader);
  const waitMs =
    Number.isFinite(seconds) && seconds > 0
      ? Math.min(seconds * 1_000, MAX_BACKPRESSURE_MS)
      : 5_000;
  backpressureUntil = Math.max(backpressureUntil, Date.now() + waitMs);
}

async function waitOutBackpressure() {
  const remaining = backpressureUntil - Date.now();
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, remaining));
}

/** Test seam: crawls are sequential, but each one starts unthrottled. */
export function resetBackpressure() {
  backpressureUntil = 0;
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

function parseRobots(content: string) {
  const disallowed: string[] = [];
  let applies = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      applies = value === "*" || /docentbot/i.test(value);
    } else if (applies && key === "disallow" && value) {
      disallowed.push(value);
    }
  }
  return (url: URL) =>
    !disallowed.some((path) => url.pathname.startsWith(path));
}

async function loadRobots(origin: string, fetchPublic: SafeFetcher) {
  try {
    const { response } = await fetchPublic(new URL("/robots.txt", origin), {
      timeoutMs: 5_000,
      maxBytes: 500_000,
      headers: { accept: "text/plain" },
    });
    if (!response.ok) return () => true;
    return parseRobots(await response.text());
  } catch {
    return () => true;
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
          throw new AppError(
            "CRAWL_RATE_LIMITED",
            `Remote server is rate limiting requests (HTTP ${response.status}). ` +
              "Lower CRAWL_CONCURRENCY if this persists.",
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
          failures.push({ url: batch[index], reason });
          onPage?.({ url: batch[index], outcome: "failed", reason });
          continue;
        }
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
    }

    if (!pages.length) {
      throw new AppError(
        "NO_CONTENT_FOUND",
        "No useful public text could be extracted from this website.",
        422,
        { failures: failures.slice(0, 10) },
      );
    }

    return {
      rootUrl: root.href,
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
