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

export type CrawlOptions = {
  url: string;
  pageLimit: number;
  includePaths?: string[];
  excludePaths?: string[];
  onProgress?: (progress: {
    discovered: number;
    processed: number;
  }) => Promise<void> | void;
};

export type CrawlResult = {
  rootUrl: string;
  brand: SiteBrand;
  pages: ExtractedPage[];
  failures: Array<{ url: string; reason: string }>;
};

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

async function discoverSitemap(root: URL, fetchPublic: SafeFetcher) {
  const candidates = [
    new URL("/sitemap.xml", root),
    new URL("/sitemap_index.xml", root),
  ];
  const urls = new Set<string>();
  for (const candidate of candidates) {
    try {
      const { response } = await fetchPublic(candidate, {
        timeoutMs: 8_000,
        maxBytes: 2_000_000,
        headers: { accept: "application/xml,text/xml" },
      });
      if (!response.ok) continue;
      const xml = await response.text();
      for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
        const value = match[1]
          .replaceAll("&amp;", "&")
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">");
        try {
          const url = new URL(value);
          if (url.origin === root.origin) urls.add(url.href);
        } catch {
          continue;
        }
      }
      if (urls.size) break;
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
  retries = 2,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const { response, finalUrl } = await fetchPublic(url, {
        timeoutMs: 15_000,
        maxBytes: 3_000_000,
      });
      if (!response.ok) {
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
          setTimeout(resolve, 350 * 2 ** attempt),
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
  onProgress,
}: CrawlOptions): Promise<CrawlResult> {
  const root = await validatePublicUrl(input);
  const limit = Math.max(1, Math.min(500, pageLimit));
  const fetchPublic = createSafeFetcher();
  const browserRenderer = createBrowserRenderer();
  const allowedByRobots = await loadRobots(root.origin, fetchPublic);
  if (!allowedByRobots(root)) {
    throw new AppError(
      "ROBOTS_BLOCKED",
      "The website's robots.txt does not allow this page to be crawled.",
      403,
    );
  }

  const sitemapUrls = (await discoverSitemap(root, fetchPublic)).slice(
    0,
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
      const batch = queue.splice(0, Math.min(6, limit - pages.length));
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
          failures.push({
            url: batch[index],
            reason:
              result.reason instanceof Error
                ? result.reason.message
                : "Unknown crawl error",
          });
          continue;
        }
        if (!result.value) continue;
        const { page, brand: pageBrand } = result.value;
        brand ??= pageBrand;
        if (
          page.text.length >= 120 &&
          !contentHashes.has(page.contentHash)
        ) {
          contentHashes.add(page.contentHash);
          pages.push(page);
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
