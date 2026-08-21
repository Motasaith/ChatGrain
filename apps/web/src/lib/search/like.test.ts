import { describe, expect, it } from "vitest";
import { likePattern } from "./like";

describe("likePattern", () => {
  it("wraps an ordinary phrase", () => {
    expect(likePattern("sudo scout")).toBe("%sudo scout%");
  });

  // Without escaping, a source named "report_2026" also matches "reportX2026",
  // and a visitor typing a bare "%" matches every row in the table.
  it("escapes SQL wildcards so they match themselves", () => {
    expect(likePattern("report_2026")).toBe("%report\\_2026%");
    expect(likePattern("50%")).toBe("%50\\%%");
  });

  it("escapes the escape character itself", () => {
    expect(likePattern("a\\b")).toBe("%a\\\\b%");
  });

  it("leaves a query with nothing to escape untouched", () => {
    expect(likePattern("docker")).toBe("%docker%");
  });
});
