import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  applyBackpressure,
  parseRetryAfter,
  parseRobots,
  resetBackpressure,
} from "./crawler";

afterEach(() => {
  resetBackpressure();
  vi.useRealTimers();
});

/**
 * A 98% failure rate on a large site is almost always the site pushing back,
 * not broken pages. These pin the behaviour that keeps a rate limit from
 * cascading into a wholly failed crawl.
 */
describe("crawl backpressure", () => {
  it("honours a Retry-After in seconds", () => {
    expect(parseRetryAfter("10")).toBe(10_000);
  });

  it("honours a Retry-After given as an HTTP date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    // Servers may answer with either form. Only the numeric one was understood,
    // so a date fell through to the 5 second default and we retried far too
    // early - straight back into the block we were waiting out.
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:01:00 GMT")).toBe(60_000);
  });

  it("caps an unreasonable Retry-After at five minutes", () => {
    // Hostile or misconfigured headers must not stall a crawl for an hour...
    expect(parseRetryAfter("3600")).toBe(300_000);
  });

  it("waits long enough to outlast a real security-plugin block", () => {
    // ...but the old 30s ceiling was under the length of a typical Wordfence
    // block, which guaranteed every retry landed inside the same block.
    expect(parseRetryAfter("300")).toBeGreaterThan(30_000);
  });

  it("falls back to a fixed pause when the header is missing or junk", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("not-a-number")).toBeUndefined();
    expect(parseRetryAfter("-5")).toBeUndefined();
    expect(() => applyBackpressure(null)).not.toThrow();
  });

  it("resets between crawls", () => {
    applyBackpressure("30");
    expect(() => resetBackpressure()).not.toThrow();
  });
});

describe("robots.txt", () => {
  it("reads Crawl-delay, so a site can set its own pace", () => {
    const rules = parseRobots("User-agent: *\nCrawl-delay: 5\n");
    expect(rules.crawlDelayMs).toBe(5_000);
  });

  it("matches the user agent we actually send", () => {
    // This matched `docentbot` long after the agent string became
    // ChatGrainBot, so every site with a rule naming our bot was ignored.
    const rules = parseRobots(
      "User-agent: ChatGrainBot\nDisallow: /private\nCrawl-delay: 3\n",
    );
    expect(rules(new URL("https://example.com/private/x"))).toBe(false);
    expect(rules(new URL("https://example.com/public"))).toBe(true);
    expect(rules.crawlDelayMs).toBe(3_000);
  });

  it("ignores directives aimed at a different crawler", () => {
    const rules = parseRobots("User-agent: AhrefsBot\nDisallow: /\n");
    expect(rules(new URL("https://example.com/anything"))).toBe(true);
  });

  it("caps an absurd Crawl-delay rather than stalling for hours", () => {
    const rules = parseRobots("User-agent: *\nCrawl-delay: 86400\n");
    expect(rules.crawlDelayMs).toBe(30_000);
  });

  it("leaves the delay unset when robots.txt does not mention one", () => {
    expect(parseRobots("User-agent: *\nDisallow: /admin\n").crawlDelayMs)
      .toBeUndefined();
  });
});
