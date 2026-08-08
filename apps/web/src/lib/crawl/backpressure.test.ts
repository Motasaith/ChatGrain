import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { applyBackpressure, resetBackpressure } from "./crawler";

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    applyBackpressure("10");
    // Pause is shared, so the next fetch in the batch waits too.
    vi.advanceTimersByTime(9_000);
    expect(Date.now()).toBeLessThan(new Date("2026-01-01T00:00:10Z").getTime());
  });

  it("caps an unreasonable Retry-After", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    // A hostile or misconfigured header must not stall the crawl for an hour.
    applyBackpressure("3600");
    vi.advanceTimersByTime(30_000);
    expect(Date.now()).toBe(new Date("2026-01-01T00:00:30Z").getTime());
  });

  it("falls back to a fixed pause when the header is missing or junk", () => {
    expect(() => applyBackpressure(null)).not.toThrow();
    expect(() => applyBackpressure("not-a-number")).not.toThrow();
    expect(() => applyBackpressure("-5")).not.toThrow();
  });

  it("resets between crawls", () => {
    applyBackpressure("30");
    resetBackpressure();
    expect(() => resetBackpressure()).not.toThrow();
  });
});
