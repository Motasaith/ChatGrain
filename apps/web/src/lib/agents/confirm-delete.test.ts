import { describe, expect, it } from "vitest";
import { deleteConfirmationMatches } from "./confirm-delete";

describe("deleteConfirmationMatches", () => {
  it("accepts the exact name", () => {
    expect(deleteConfirmationMatches("HOC 2.0", "HOC 2.0")).toBe(true);
  });

  it("forgives case and stray whitespace", () => {
    expect(deleteConfirmationMatches("  hoc 2.0 ", "HOC 2.0")).toBe(true);
    expect(deleteConfirmationMatches("HOC  2.0", "HOC 2.0")).toBe(true);
  });

  it("rejects a near-identical sibling", () => {
    // The whole point: these four coexist in one workspace.
    expect(deleteConfirmationMatches("FileViewerHub", "FileViewerHub 2.0")).toBe(
      false,
    );
    expect(deleteConfirmationMatches("FileViewerHub 3.0", "FileViewerHub")).toBe(
      false,
    );
    expect(deleteConfirmationMatches("HOC", "HOC 2.0")).toBe(false);
  });

  it("rejects an empty box", () => {
    expect(deleteConfirmationMatches("", "HOC")).toBe(false);
    expect(deleteConfirmationMatches("   ", "HOC")).toBe(false);
  });

  it("cannot be satisfied when the agent has no name", () => {
    expect(deleteConfirmationMatches("", "")).toBe(false);
    expect(deleteConfirmationMatches("  ", "   ")).toBe(false);
  });
});
