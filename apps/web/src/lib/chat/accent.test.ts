import { describe, expect, it } from "vitest";
import {
  readableAccent,
  readableTextColor,
  relativeLuminance,
} from "./accent";

describe("readableAccent", () => {
  it("darkens a near-white accent into something visible", () => {
    // The reported bug: this agent is configured #fafafa, so chips and the
    // caret were painted white on white.
    expect(relativeLuminance(readableAccent("#fafafa"))).toBeLessThanOrEqual(
      0.32,
    );
  });

  it("leaves an already-dark accent alone", () => {
    expect(readableAccent("#177e51")).toBe("#177e51");
  });

  it("keeps the hue of a merely light accent", () => {
    // A light blue should stay blue, not turn grey.
    const result = readableAccent("#8ecbff");
    const [r, g, b] = [1, 3, 5].map((index) =>
      parseInt(result.slice(index, index + 2), 16),
    );
    expect(b).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(r);
  });

  it("handles shorthand and malformed input without throwing", () => {
    expect(() => readableAccent("#fff")).not.toThrow();
    expect(relativeLuminance(readableAccent("#fff"))).toBeLessThanOrEqual(0.32);
    expect(readableAccent("not-a-colour")).toBe("#0f1f16");
    expect(readableAccent("")).toBe("#0f1f16");
  });

  it("always returns something readable, whatever the input", () => {
    for (const hex of ["#ffffff", "#000000", "#fafafa", "#ffff00", "#00ff00"]) {
      expect(relativeLuminance(readableAccent(hex))).toBeLessThanOrEqual(0.32);
    }
  });
});

describe("readableTextColor", () => {
  it("puts dark text on a light accent and white on a dark one", () => {
    expect(readableTextColor("#fafafa")).toBe("#0f1f16");
    expect(readableTextColor("#177e51")).toBe("#ffffff");
  });
});
