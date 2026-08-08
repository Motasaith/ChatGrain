import { describe, expect, it } from "vitest";
import { cleanPageTitle, titlePrecision } from "./title";

describe("titlePrecision", () => {
  it("ranks an exact title above one padded with extra words", () => {
    const terms = ["time", "calculator"];
    expect(titlePrecision("Time Calculator | Home of Calculators", terms)).toBe(1);
    expect(
      titlePrecision("Screen Time Calculator | Home of Calculators", terms),
    ).toBeLessThan(1);
    expect(
      titlePrecision("Time Duration Calculator | Home of Calculators", terms),
    ).toBeLessThan(1);
  });

  it("treats a plural title word as covered", () => {
    expect(titlePrecision("Calculators", ["calculator"])).toBe(1);
  });

  it("is zero when there is nothing to compare", () => {
    expect(titlePrecision("Time Calculator", [])).toBe(0);
    expect(titlePrecision("", ["time"])).toBe(0);
  });
});

describe("cleanPageTitle", () => {
  it("drops the site name but keeps hyphenated words", () => {
    expect(cleanPageTitle("Refund Policy - Acme Store")).toBe("Refund Policy");
    expect(cleanPageTitle("Set-up guide")).toBe("Set-up guide");
  });
});
