import { describe, expect, it } from "vitest";
import {
  buildCrawlQueue,
  isInfrastructureHref,
  isInfrastructureUrl,
} from "./crawler";

const url = (href: string) => new URL(href);

describe("isInfrastructureUrl", () => {
  // The URL that forced this to exist. Cloudflare mints a fresh random id per
  // render, so every one of these is a URL never seen before, carrying decoy
  // text. Left alone, a crawl of any Cloudflare-fronted site never converges.
  it("rejects the Cloudflare content endpoint", () => {
    expect(
      isInfrastructureUrl(
        url(
          "https://pic-microcontroller.com/cdn-cgi/content?id=ivNwqxMreiPVh2sLULd7MdpbC0as4sIYcV2R1vA5nPo-1787404415",
        ),
      ),
    ).toBe(true);
  });

  it("rejects the rest of the Cloudflare namespace", () => {
    expect(isInfrastructureUrl(url("https://x.test/cdn-cgi/l/email-protection"))).toBe(true);
    expect(isInfrastructureUrl(url("https://x.test/cdn-cgi/challenge-platform/"))).toBe(true);
  });

  it("rejects WordPress machinery", () => {
    for (const path of ["/wp-json/wp/v2/posts", "/wp-admin/", "/wp-login.php", "/xmlrpc.php"]) {
      expect(isInfrastructureUrl(url(`https://x.test${path}`)), path).toBe(true);
    }
  });

  // The half that matters more: over-blocking silently loses real pages, and
  // nothing in the dashboard would explain why.
  it("leaves ordinary pages alone", () => {
    for (const path of [
      "/",
      "/blog/casaos-personal-cloud-server-guide/",
      "/tag/ultrasonic-sensors/",
      "/about",
      "/products/wp-plugin-guide",
      "/how-to-secure-wp-login",
    ]) {
      expect(isInfrastructureUrl(url(`https://x.test${path}`)), path).toBe(false);
    }
  });

  // Matched on the path, so the string appearing in a query does not count.
  it("ignores the marker when it is only in a query string", () => {
    expect(
      isInfrastructureUrl(url("https://x.test/search?q=/cdn-cgi/")),
    ).toBe(false);
  });

  it("treats an unparseable href as not infrastructure", () => {
    expect(isInfrastructureHref("not a url")).toBe(false);
  });
});

describe("buildCrawlQueue with infrastructure", () => {
  it("drops infrastructure arriving from a sitemap", () => {
    const { queue } = buildCrawlQueue({
      rootHref: "https://x.test/",
      sitemapUrls: ["https://x.test/real", "https://x.test/cdn-cgi/content?id=1"],
    });
    expect(queue).toEqual(["https://x.test/", "https://x.test/real"]);
  });

  // An inventory saved before this rule existed still holds these URLs, so the
  // seeds have to be filtered too or the trap survives the fix.
  it("drops infrastructure arriving from a saved inventory", () => {
    const { queue } = buildCrawlQueue({
      rootHref: "https://x.test/",
      seedUrls: ["https://x.test/cdn-cgi/content?id=2", "https://x.test/keep"],
    });
    expect(queue).toEqual(["https://x.test/", "https://x.test/keep"]);
  });
});
