import { CRAWLER_USER_AGENT } from "@/lib/crawl/user-agent";
import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { AppError } from "@/lib/http/errors";
import { validatePublicUrl } from "@/lib/security/public-url";

const minimumUsefulText = 120;

function boundedNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.round(parsed)))
    : fallback;
}

function browserCandidates() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
  ];
  if (process.platform === "win32") {
    candidates.push(
      process.env.PROGRAMFILES
        ? `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`
        : undefined,
      process.env["PROGRAMFILES(X86)"]
        ? `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`
        : undefined,
      process.env.LOCALAPPDATA
        ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
        : undefined,
      process.env.PROGRAMFILES
        ? `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`
        : undefined,
      process.env["PROGRAMFILES(X86)"]
        ? `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`
        : undefined,
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    );
  }
  return candidates.find(
    (candidate): candidate is string =>
      Boolean(candidate && existsSync(candidate)),
  );
}

/**
 * Markers left in the HTML by a framework that renders on the client.
 *
 * Only consulted when the page arrived nearly empty, so a false positive costs
 * one wasted render rather than a wrong answer. Missing a framework is the
 * expensive direction: the page is indexed as the handful of words in its
 * loading shell, and the site looks like it has no content.
 */
const CLIENT_RENDERED_MARKERS = [
  /self\.__next_f\.push|__NEXT_DATA__/i, // Next.js
  /data-reactroot|__REACT_DEVTOOLS/i, // React
  /ng-version|<app-root/i, // Angular
  /__NUXT__|__nuxt/i, // Nuxt
  /___gatsby/i, // Gatsby
  /data-svelte-h|__sveltekit_/i, // SvelteKit
  /__remixContext/i, // Remix
  /data-v-app|__VUE__/i, // Vue
  // A mount point on any element, not just a div.
  //
  // This pattern was hardcoded to <div>, and TodoMVC's React example mounts
  // on <section class="todoapp" id="root">. The result was the worst kind of
  // miss: a page with literally zero text read as an ordinary page and
  // indexed as nothing at all. Frameworks mount on whatever element the
  // author picked, so the element name is not something to assume.
  /<[a-z][a-z0-9-]*[^>]*\sid=["'](?:root|app|__next|__nuxt|svelte|mount)["']/i,
];

/**
 * Whether a page has to be run in a browser to have any content at all.
 *
 * `force` is the operator's override, for the case this heuristic cannot cover:
 * a hand-rolled client-side site with no framework fingerprint, which arrives
 * as a blank shell and matches nothing. There is no way to infer that from the
 * markup, so it is a setting rather than a guess.
 */
export function needsBrowserRendering(
  html: string,
  text: string,
  force: "auto" | "always" | "never" = "auto",
) {
  if (force === "never") return false;
  if (force === "always") return true;
  if (text.trim().length >= minimumUsefulText) return false;
  return CLIENT_RENDERED_MARKERS.some((marker) => marker.test(html));
}

export type BrowserRenderer = {
  render: (
    url: URL,
  ) => Promise<{ html: string; finalUrl: URL }>;
  close: () => Promise<void>;
};

export function createBrowserRenderer({
  allowPrivate = false,
}: { allowPrivate?: boolean } = {}): BrowserRenderer {
  const renderTimeoutMs = boundedNumber(
    process.env.CRAWL_RENDER_TIMEOUT_MS,
    10_000,
    1_000,
    30_000,
  );
  const concurrency = boundedNumber(
    process.env.CRAWL_RENDER_CONCURRENCY,
    3,
    1,
    6,
  );
  let browserPromise: Promise<Browser> | undefined;
  let contextPromise: Promise<BrowserContext> | undefined;
  let active = 0;
  const waiters: Array<() => void> = [];

  async function withSlot<T>(task: () => Promise<T>) {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiters.shift()?.();
    }
  }

  async function getContext() {
    if (!contextPromise) {
      contextPromise = (async () => {
        const executablePath = browserCandidates();
        if (!executablePath) {
          throw new AppError(
            "BROWSER_UNAVAILABLE",
            "This page requires JavaScript rendering. Install Chrome or Chromium, or set BROWSER_EXECUTABLE_PATH.",
            503,
          );
        }
        browserPromise = chromium.launch({
          executablePath,
          headless: true,
          chromiumSandbox:
            process.env.BROWSER_DISABLE_SANDBOX !== "true",
          args: ["--disable-dev-shm-usage"],
        });
        const browser = await browserPromise;
        const context = await browser.newContext({
          serviceWorkers: "block",
          // The same agent string the plain fetcher sends. Chromium otherwise
          // announces itself as a desktop browser, which is both dishonest and
          // in practice worse: hosts exist that allow declared bots and block
          // anything claiming to be Chrome from a datacenter address, so the
          // rendered half of a crawl could be refused while the fetched half
          // succeeded - on the same site, in the same run.
          userAgent: CRAWLER_USER_AGENT,
        });
        await context.route("**/*", async (route) => {
          const request = route.request();
          if (
            ["image", "media", "font"].includes(request.resourceType())
          ) {
            await route.abort("blockedbyclient");
            return;
          }
          try {
            const requestUrl = new URL(request.url());
            if (!["http:", "https:"].includes(requestUrl.protocol)) {
              await route.abort("blockedbyclient");
              return;
            }
            await validatePublicUrl(requestUrl.href, { allowPrivate });
            await route.continue();
          } catch {
            await route.abort("blockedbyclient");
          }
        });
        return context;
      })();
    }
    return contextPromise;
  }

  return {
    render: (url) =>
      withSlot(async () => {
        await validatePublicUrl(url.href, { allowPrivate });
        const context = await getContext();
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const page = await context.newPage();
          try {
            const response = await page.goto(url.href, {
              waitUntil: "domcontentloaded",
              timeout: renderTimeoutMs,
            });
            if (response && !response.ok()) {
              throw new AppError(
                "BROWSER_HTTP_ERROR",
                `Rendered page returned HTTP ${response.status()}.`,
                502,
              );
            }
            await page
              .waitForFunction(
                (minimumLength) => {
                  const root =
                    document.querySelector("main, article") ??
                    document.body;
                  const text = (root?.textContent ?? "")
                    .replace(/\s+/g, " ")
                    .trim();
                  return (
                    text.length >= minimumLength &&
                    !/^(loading|please wait|initializing)[.!…]*$/i.test(
                      text,
                    )
                  );
                },
                minimumUsefulText,
                { timeout: renderTimeoutMs },
              )
              .catch(() => undefined);
            const finalUrl = await validatePublicUrl(page.url(), {
              allowPrivate,
            });
            const renderedText = (await page.locator("body").innerText())
              .replace(/\s+/g, " ")
              .trim();
            if (renderedText.length < minimumUsefulText) {
              throw new AppError(
                "BROWSER_RENDER_EMPTY",
                "The page loaded but did not render useful public text.",
                422,
              );
            }
            const html = await page.content();
            if (Buffer.byteLength(html, "utf8") > 5_000_000) {
              throw new AppError(
                "REMOTE_CONTENT_TOO_LARGE",
                "The rendered page exceeds the 5 MB limit.",
                413,
              );
            }
            return { html, finalUrl };
          } catch (error) {
            lastError = error;
            if (
              !(error instanceof AppError) ||
              error.code !== "BROWSER_RENDER_EMPTY" ||
              attempt > 0
            ) {
              throw error;
            }
          } finally {
            await page.close();
          }
        }
        throw lastError;
      }),
    close: async () => {
      const context = await contextPromise?.catch(() => undefined);
      await context?.close();
      const browser = await browserPromise?.catch(() => undefined);
      await browser?.close();
    },
  };
}
