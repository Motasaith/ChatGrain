import { describe, expect, it } from "vitest";
import { pageLimitOptions } from "./page-limit-options";

/**
 * The crawl-size choices.
 *
 * These existed twice and had drifted: creating an agent offered six options,
 * adding a website to one offered two. One list now, so the interesting cases
 * are what happens at the edges of a customer's ceiling - where an option must
 * never be offered that the API would then refuse.
 */
describe("page limit options", () => {
  it("offers every step below the ceiling, then the whole site", () => {
    expect(pageLimitOptions(10_000).map((option) => option.value)).toEqual([
      100, 500, 1_000, 2_500, 5_000, 10_000,
    ]);
  });

  it("names the largest choice by what it means", () => {
    expect(pageLimitOptions(10_000).at(-1)?.label).toBe(
      "Entire site (up to 10,000 pages)",
    );
  });

  it("groups digits, because 10000 is harder to read than 10,000", () => {
    expect(pageLimitOptions(10_000)[4].label).toBe("5,000 pages");
  });

  /**
   * The rule that keeps this honest: nothing above the ceiling is ever
   * offered. A menu that lists a number the API will refuse is worse than a
   * short menu, because the refusal arrives after the click.
   */
  it("never offers more than the ceiling", () => {
    for (const ceiling of [100, 500, 1_000, 2_500, 5_000, 10_000, 137]) {
      for (const option of pageLimitOptions(ceiling)) {
        expect(option.value).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it("drops the steps that meet or exceed a low ceiling", () => {
    expect(pageLimitOptions(500).map((option) => option.value)).toEqual([
      100, 500,
    ]);
    expect(pageLimitOptions(1_000).map((option) => option.value)).toEqual([
      100, 500, 1_000,
    ]);
  });

  /**
   * A ceiling at or below the smallest step still has to produce a usable
   * menu - an empty select is a control that cannot be answered.
   */
  it("always offers at least one choice", () => {
    expect(pageLimitOptions(100)).toEqual([
      { value: 100, label: "Entire site (up to 100 pages)" },
    ]);
    expect(pageLimitOptions(1)).toHaveLength(1);
    expect(pageLimitOptions(0)).toHaveLength(1);
    expect(pageLimitOptions(-5)[0].value).toBeGreaterThan(0);
  });

  it("never offers the same number twice", () => {
    for (const ceiling of [100, 500, 2_500, 10_000]) {
      const values = pageLimitOptions(ceiling).map((option) => option.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("rounds a fractional ceiling down rather than offering a fraction", () => {
    expect(pageLimitOptions(750.9).at(-1)?.value).toBe(750);
  });
});
