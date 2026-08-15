import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { compareToBaseline } from "./run";
import { summarise, type CaseResult } from "./metrics";

function report(ranks: number[]) {
  const results: CaseResult[] = ranks.map((rank, index) => ({
    caseId: String(index),
    question: `q${index}`,
    rank,
    abstained: rank === 0,
    unanswerable: false,
  }));
  return summarise(results);
}

describe("compareToBaseline", () => {
  it("fails the build on a real recall drop", () => {
    const baseline = report([1, 1, 1, 1]);
    const current = report([1, 1, 0, 0]);
    const verdict = compareToBaseline(current, baseline);
    expect(verdict.regressed).toBe(true);
    expect(verdict.summary).toContain("fell");
  });

  it("stays quiet inside the tolerance band", () => {
    // The index changes on every crawl, so an exact-equality gate would turn
    // red every time a customer edits a page.
    const baseline = report(Array.from({ length: 100 }, () => 1));
    const current = report([
      0,
      ...Array.from({ length: 99 }, () => 1),
    ]);
    expect(compareToBaseline(current, baseline).regressed).toBe(false);
  });

  it("never flags an improvement as a regression", () => {
    const verdict = compareToBaseline(report([1, 1]), report([1, 0]));
    expect(verdict.regressed).toBe(false);
    expect(verdict.recallDelta).toBeGreaterThan(0);
  });

  it("reports MRR movement even when recall is unchanged", () => {
    // Both recall 100% at 8; only MRR shows the answer sank down the list,
    // which is the early warning that a ranking change is going wrong.
    const baseline = report([1, 1]);
    const current = report([6, 7]);
    const verdict = compareToBaseline(current, baseline);
    expect(verdict.regressed).toBe(false);
    expect(verdict.mrrDelta).toBeLessThan(0);
  });
});
