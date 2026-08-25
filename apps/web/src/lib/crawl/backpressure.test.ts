import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GAP_RECOVERY_SUCCESSES,
  applyBackpressure,
  parseRetryAfter,
  parseRobots,
  recoveredGap,
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

/**
 * Recovery from backoff.
 *
 * The gap doubles on a single 429 and used to stay there for the whole run -
 * the comment where this logic should have been said so outright: "it never
 * narrows within a crawl". One bad minute early on therefore set the pace for
 * everything after it. A 17,447-URL site was still crawling after 48 hours for
 * exactly this reason, at roughly two requests a minute, and it was diagnosed
 * as a memory problem for a week before anyone measured the gap.
 */
describe("request gap recovery", () => {
  const FLOOR = 1_000;

  it("does nothing while the gap is already at the floor", () => {
    const next = recoveredGap(FLOOR, FLOOR, 0);
    expect(next).toEqual({ gap: FLOOR, cleanRun: 0 });
  });

  it("counts clean fetches without moving the gap yet", () => {
    const next = recoveredGap(8_000, FLOOR, 0);
    expect(next).toEqual({ gap: 8_000, cleanRun: 1 });
  });

  it("halves the gap once the clean run is long enough", () => {
    const next = recoveredGap(8_000, FLOOR, GAP_RECOVERY_SUCCESSES - 1);
    expect(next).toEqual({ gap: 4_000, cleanRun: 0 });
  });

  it("walks all the way back to the floor and stops there", () => {
    let gap = 30_000;
    let cleanRun = 0;
    // Far more successes than the walk down needs, to prove it settles rather
    // than continuing past the floor.
    for (let i = 0; i < GAP_RECOVERY_SUCCESSES * 12; i += 1) {
      const next = recoveredGap(gap, FLOOR, cleanRun);
      gap = next.gap;
      cleanRun = next.cleanRun;
    }
    expect(gap).toBe(FLOOR);
  });

  // A site's published Crawl-delay is the floor, and recovery must not undercut
  // it just because the site has been quiet.
  it("never recovers below a Crawl-delay the site published", () => {
    const declared = 10_000;
    let gap = 30_000;
    let cleanRun = 0;
    for (let i = 0; i < GAP_RECOVERY_SUCCESSES * 12; i += 1) {
      const next = recoveredGap(gap, declared, cleanRun);
      gap = next.gap;
      cleanRun = next.cleanRun;
    }
    expect(gap).toBe(declared);
  });

  // Backing off fast and returning slowly is the safe direction to be wrong in.
  it("recovers more slowly than it backs off", () => {
    const afterOnePushback = 2_000;
    const oneSuccess = recoveredGap(afterOnePushback, FLOOR, 0);
    expect(oneSuccess.gap).toBe(afterOnePushback);
  });
});
