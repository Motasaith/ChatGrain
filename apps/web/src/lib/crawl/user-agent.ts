/**
 * How this crawler identifies itself, everywhere.
 *
 * One constant because the two halves of a crawl must agree. The plain fetcher
 * sent this while headless Chromium sent a default desktop-browser string, and
 * a host that allows declared bots but blocks browser-shaped requests from a
 * datacenter address would refuse only the rendered pages - the same site,
 * the same run, one half working.
 */
export const CRAWLER_USER_AGENT =
  "ChatGrainBot/0.2 (+https://chatgrain.com/bot)";
