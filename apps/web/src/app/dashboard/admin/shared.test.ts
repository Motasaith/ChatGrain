import { describe, expect, it } from "vitest";
import { adminHref, formatBytes, likePattern, readPage, readParam } from "./shared";

/**
 * The admin console keeps every filter in the URL, so these helpers decide
 * what a shared link means. A wrong one does not fail loudly: it shows a
 * different list, which reads as a correct answer to a different question.
 */
describe("admin console helpers", () => {
  it("reads the first value of a repeated parameter, trimmed", () => {
    expect(readParam({ q: ["  acme ", "other"] }, "q")).toBe("acme");
    expect(readParam({}, "q")).toBe("");
  });

  it("treats a missing, negative or malformed page as the first page", () => {
    expect(readPage({})).toBe(0);
    expect(readPage({ page: "-3" })).toBe(0);
    expect(readPage({ page: "abc" })).toBe(0);
    expect(readPage({ page: "2" })).toBe(2);
  });

  it("builds links that leave out empty filters and the first page", () => {
    expect(adminHref("jobs", { status: "failed", q: "", page: 0 })).toBe(
      "/dashboard/admin?tab=jobs&status=failed",
    );
    expect(adminHref("people", { q: "a b&c", page: 2 })).toBe(
      "/dashboard/admin?tab=people&q=a+b%26c&page=2",
    );
  });

  it("escapes LIKE wildcards so a search means what was typed", () => {
    expect(likePattern("50%")).toBe("%50\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("c:\\path")).toBe("%c:\\\\path%");
  });

  it("formats sizes and never shows a negative or NaN", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
});
