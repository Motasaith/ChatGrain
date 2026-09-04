import { describe, expect, it } from "vitest";
import { copyName } from "./copy-name";

/**
 * Naming a copy.
 *
 * The case that matters is the second copy. Two agents called "Support (copy)"
 * are exactly the situation the delete confirmation elsewhere in this
 * application warns about - workspaces accumulate near-identical names, and
 * telling them apart afterwards costs somebody an afternoon and occasionally
 * the wrong deletion.
 */
describe("naming a duplicated agent", () => {
  it("marks a first copy", () => {
    expect(copyName("Support")).toBe("Support (copy)");
  });

  it("numbers the second, rather than repeating the first", () => {
    expect(copyName("Support (copy)")).toBe("Support (copy 2)");
  });

  it("keeps counting", () => {
    expect(copyName("Support (copy 2)")).toBe("Support (copy 3)");
    expect(copyName("Support (copy 9)")).toBe("Support (copy 10)");
  });

  it("leaves a name that only looks like a copy alone", () => {
    // Not the suffix pattern, so it is part of the name and stays part of it.
    expect(copyName("Support (copy of Sales)")).toBe(
      "Support (copy of Sales) (copy)",
    );
  });

  /**
   * The column is 80 characters. The name is trimmed rather than the suffix,
   * because the suffix is the part that says which one this is - a shortened
   * name with "(copy 2)" intact is still usable, and a full name with the
   * marker cut off is not.
   */
  it("stays within the column, trimming the name and not the marker", () => {
    const result = copyName("x".repeat(200));
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith(" (copy)")).toBe(true);
  });

  it("never returns an empty name", () => {
    expect(copyName("").length).toBeGreaterThan(0);
  });
});
