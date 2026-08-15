import { describe, expect, it } from "vitest";

import {
  abstentionScores,
  firstHitRank,
  formatReport,
  meanReciprocalRank,
  recallAt,
  summarise,
  type CaseResult,
} from "./metrics";

describe("firstHitRank", () => {
  it("returns a 1-based position so rank 1 means top result", () => {
    const rank = firstHitRank(
      [{ chunkId: "a" }, { chunkId: "b" }, { chunkId: "c" }],
      { expectedChunkIds: ["c"] },
    );
    expect(rank).toBe(3);
  });

  it("accepts any of several correct chunks", () => {
    // A fact often appears on more than one page. Marking a run wrong for
    // finding the other copy would measure nothing useful.
    const rank = firstHitRank([{ chunkId: "x" }, { chunkId: "b" }], {
      expectedChunkIds: ["a", "b"],
    });
    expect(rank).toBe(2);
  });

  it("matches on URL when chunk ids have churned", () => {
    // Re-indexing mints new chunk ids, so a golden set pinned only to ids
    // would report a total collapse after every crawl.
    const rank = firstHitRank(
      [{ chunkId: "new-id", url: "https://site.test/refunds" }],
      { expectedChunkIds: ["old-id"], expectedUrls: ["https://site.test/refunds"] },
    );
    expect(rank).toBe(1);
  });

  it("returns 0 when nothing acceptable was retrieved", () => {
    expect(firstHitRank([{ chunkId: "x" }], { expectedChunkIds: ["a"] })).toBe(0);
  });
});

describe("recallAt", () => {
  it("counts only hits at or above the cutoff", () => {
    const results = [{ rank: 1 }, { rank: 8 }, { rank: 9 }, { rank: 0 }];
    expect(recallAt(results, 8)).toBe(0.5);
    expect(recallAt(results, 1)).toBe(0.25);
  });

  it("treats a miss as a miss, not as a large rank", () => {
    // rank 0 is the sentinel for "never found". Comparing it numerically
    // against k would score every miss as a hit at position 0.
    expect(recallAt([{ rank: 0 }], 8)).toBe(0);
  });

  it("is 0 rather than NaN on an empty set", () => {
    expect(recallAt([], 8)).toBe(0);
  });
});

describe("meanReciprocalRank", () => {
  it("rewards answers nearer the top", () => {
    expect(meanReciprocalRank([{ rank: 1 }])).toBe(1);
    expect(meanReciprocalRank([{ rank: 4 }])).toBe(0.25);
  });

  it("separates corpora that recall identically but rank differently", () => {
    // Both recall 100% at 8; only MRR shows one puts the answer first.
    const top = meanReciprocalRank([{ rank: 1 }, { rank: 1 }]);
    const buried = meanReciprocalRank([{ rank: 7 }, { rank: 8 }]);
    expect(recallAt([{ rank: 1 }, { rank: 1 }], 8)).toBe(
      recallAt([{ rank: 7 }, { rank: 8 }], 8),
    );
    expect(top).toBeGreaterThan(buried);
  });

  it("scores a miss as zero", () => {
    expect(meanReciprocalRank([{ rank: 0 }, { rank: 1 }])).toBe(0.5);
  });
});

describe("abstentionScores", () => {
  it("catches an agent that refuses everything", () => {
    // Perfect precision, and the two-number split is what exposes it: it
    // refused three answerable questions to get there.
    const scores = abstentionScores([
      { abstained: true, unanswerable: true },
      { abstained: true, unanswerable: false },
      { abstained: true, unanswerable: false },
      { abstained: true, unanswerable: false },
    ]);
    expect(scores.precision).toBe(0.25);
    expect(scores.recall).toBe(1);
    expect(scores.falseRefusals).toBe(3);
  });

  it("catches an agent that never refuses", () => {
    const scores = abstentionScores([
      { abstained: false, unanswerable: true },
      { abstained: false, unanswerable: false },
    ]);
    // Nothing was refused, so no refusal was wrong - precision is vacuously
    // perfect and only recall reveals the hallucination risk.
    expect(scores.precision).toBe(1);
    expect(scores.recall).toBe(0);
  });
});

describe("summarise", () => {
  const results: CaseResult[] = [
    { caseId: "1", question: "refund?", rank: 1, abstained: false, unanswerable: false },
    { caseId: "2", question: "shipping?", rank: 0, abstained: true, unanswerable: false },
    { caseId: "3", question: "ceo's dog?", rank: 0, abstained: true, unanswerable: true },
  ];

  it("measures retrieval only over answerable cases", () => {
    // Case 3 has no correct chunk to find. Counting it would drag recall down
    // by the share of deliberately unanswerable cases and make the number
    // incomparable between golden sets with different mixes.
    const report = summarise(results);
    expect(report.recallAt8).toBe(0.5);
    expect(report.cases).toBe(3);
  });

  it("reports the questions that were never retrieved", () => {
    const report = summarise(results);
    expect(report.misses).toEqual([{ caseId: "2", question: "shipping?" }]);
  });

  it("scores abstention over every case", () => {
    const report = summarise(results);
    expect(report.abstentionPrecision).toBe(0.5);
    expect(report.falseRefusals).toBe(1);
  });
});

describe("formatReport", () => {
  it("renders percentages and lists misses", () => {
    const text = formatReport(
      summarise([
        { caseId: "1", question: "refund?", rank: 1, abstained: false, unanswerable: false },
        { caseId: "2", question: "shipping?", rank: 0, abstained: false, unanswerable: false },
      ]),
    );
    expect(text).toContain("recall@8              50.0%");
    expect(text).toContain("shipping?");
  });
});
