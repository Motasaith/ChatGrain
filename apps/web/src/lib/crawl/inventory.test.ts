import { describe, expect, it } from "vitest";
import { buildCrawlQueue } from "./crawler";

const ROOT = "https://inv.test/";
const A = "https://inv.test/a";
const B = "https://inv.test/b";

describe("buildCrawlQueue", () => {
  it("starts at the root when there is nothing else", () => {
    expect(buildCrawlQueue({ rootHref: ROOT }).queue).toEqual([ROOT]);
  });

  it("keeps root first, then sitemap, then the saved inventory", () => {
    const { queue } = buildCrawlQueue({
      rootHref: ROOT,
      sitemapUrls: [A],
      seedUrls: [B],
    });
    expect(queue).toEqual([ROOT, A, B]);
  });

  it("never queues the same URL twice", () => {
    const { queue } = buildCrawlQueue({
      rootHref: ROOT,
      sitemapUrls: [ROOT, A],
      seedUrls: [A, ROOT],
    });
    expect(queue).toEqual([ROOT, A]);
  });

  // The whole point of resume: an interrupted crawl must not pay again for the
  // pages it already finished. Before this, a restart began at URL one.
  it("leaves out URLs an earlier attempt already fetched", () => {
    const { queue } = buildCrawlQueue({
      rootHref: ROOT,
      seedUrls: [A, B],
      skipUrls: new Set([A]),
    });
    expect(queue).toEqual([ROOT, B]);
  });

  it("leaves out URLs the operator excluded", () => {
    const { queue } = buildCrawlQueue({
      rootHref: ROOT,
      seedUrls: [A, B],
      blockedUrls: new Set([B]),
    });
    expect(queue).toEqual([ROOT, A]);
  });

  // A skipped or blocked URL that arrives later as a link from some other page
  // has to be refused too, and `queued` is what the crawl checks for that.
  it("marks skipped and blocked URLs as already seen", () => {
    const { queued } = buildCrawlQueue({
      rootHref: ROOT,
      skipUrls: new Set([A]),
      blockedUrls: new Set([B]),
    });
    expect(queued.has(A)).toBe(true);
    expect(queued.has(B)).toBe(true);
  });

  // Regression: the first version filtered duplicates out of the queue array
  // but only added skip and block URLs to the `queued` set afterwards, so a
  // seed that was also skipped stayed in the array and was fetched anyway.
  it("does not fetch a seed that is also skipped", () => {
    const { queue } = buildCrawlQueue({
      rootHref: ROOT,
      sitemapUrls: [A],
      seedUrls: [A],
      skipUrls: new Set([A]),
    });
    expect(queue).not.toContain(A);
  });

  it("honours an exclusion covering the root itself", () => {
    const { queue } = buildCrawlQueue({
      rootHref: ROOT,
      blockedUrls: new Set([ROOT]),
      seedUrls: [A],
    });
    expect(queue).toEqual([A]);
  });
});
