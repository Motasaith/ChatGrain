/**
 * Retrieval metrics.
 *
 * Deliberately pure and dependency-free: no database, no model, no network.
 * The point of a harness is to be trusted, and a metric that needs a fixture
 * to run is a metric nobody checks. Everything here takes plain arrays.
 *
 * The unit of measurement is the *case*: one question, plus the identifiers
 * that would count as a correct answer for it. A case can name several
 * acceptable chunks, because a fact often appears on more than one page and
 * marking a run wrong for finding the other copy measures nothing useful.
 */

export type EvalCase = {
  id: string;
  question: string;
  /** Chunk ids that count as correct. Any one of them is a hit. */
  expectedChunkIds: string[];
  /** Source URLs that count as correct, for corpora where chunk ids churn. */
  expectedUrls?: string[];
  /**
   * True when the right behaviour is to refuse. Needed to tell "abstained
   * because it could not find the answer" apart from "abstained correctly
   * because the site genuinely does not answer this".
   */
  unanswerable?: boolean;
};

export type RetrievedChunk = {
  chunkId: string;
  url?: string;
};

/** Where the first acceptable chunk appeared, 1-based. 0 means "not found". */
export function firstHitRank(
  retrieved: RetrievedChunk[],
  expectation: Pick<EvalCase, "expectedChunkIds" | "expectedUrls">,
): number {
  const ids = new Set(expectation.expectedChunkIds);
  const urls = new Set(expectation.expectedUrls ?? []);
  for (let index = 0; index < retrieved.length; index += 1) {
    const hit = retrieved[index];
    if (ids.has(hit.chunkId)) return index + 1;
    if (hit.url && urls.has(hit.url)) return index + 1;
  }
  return 0;
}

/**
 * Share of cases whose answer appeared in the top `k`.
 *
 * This is the number that decides whether the model ever had a chance. An
 * answer the retriever never surfaced cannot be produced by any prompt, so a
 * recall regression is the one result that should fail a build outright.
 */
export function recallAt(
  results: Array<{ rank: number }>,
  k: number,
): number {
  if (!results.length) return 0;
  const found = results.filter(
    (item) => item.rank > 0 && item.rank <= k,
  ).length;
  return found / results.length;
}

/**
 * Mean reciprocal rank.
 *
 * Recall alone cannot tell a corpus that answers at position 1 from one that
 * answers at position 8, and the difference matters: everything below the
 * first couple of chunks competes for the model's attention with whatever
 * else was retrieved.
 */
export function meanReciprocalRank(results: Array<{ rank: number }>): number {
  if (!results.length) return 0;
  const total = results.reduce(
    (sum, item) => sum + (item.rank > 0 ? 1 / item.rank : 0),
    0,
  );
  return total / results.length;
}

export type AbstentionOutcome = {
  /** Whether the agent refused to answer. */
  abstained: boolean;
  /** Whether refusing was the right call for this case. */
  unanswerable: boolean;
};

/**
 * How trustworthy a refusal is, and how much answerable traffic it costs.
 *
 * Two numbers rather than one, because they fail in opposite directions and a
 * single score hides which is happening. An agent that refuses everything
 * scores perfect precision; an agent that answers everything scores perfect
 * recall. Only reading both catches either.
 */
export function abstentionScores(outcomes: AbstentionOutcome[]) {
  const abstained = outcomes.filter((item) => item.abstained);
  const shouldAbstain = outcomes.filter((item) => item.unanswerable);
  const correctlyAbstained = abstained.filter((item) => item.unanswerable);
  return {
    /** Of the refusals, how many were right. */
    precision: abstained.length
      ? correctlyAbstained.length / abstained.length
      : 1,
    /** Of the questions it should have refused, how many it did refuse. */
    recall: shouldAbstain.length
      ? correctlyAbstained.length / shouldAbstain.length
      : 1,
    /** Answerable questions wrongly refused - the cost side of abstention. */
    falseRefusals: abstained.filter((item) => !item.unanswerable).length,
  };
}

export type CaseResult = {
  caseId: string;
  question: string;
  rank: number;
  abstained: boolean;
  unanswerable: boolean;
};

export type EvalReport = {
  cases: number;
  recallAt1: number;
  recallAt5: number;
  recallAt8: number;
  mrr: number;
  abstentionPrecision: number;
  abstentionRecall: number;
  falseRefusals: number;
  /** Cases where nothing acceptable was retrieved at any depth. */
  misses: Array<{ caseId: string; question: string }>;
};

export function summarise(results: CaseResult[]): EvalReport {
  // Abstention is judged over every case, but retrieval only over the ones
  // that have a correct answer to find. Mixing them would drag recall down by
  // the share of deliberately unanswerable cases and make the number
  // incomparable between golden sets with different mixes.
  const answerable = results.filter((item) => !item.unanswerable);
  return {
    cases: results.length,
    recallAt1: recallAt(answerable, 1),
    recallAt5: recallAt(answerable, 5),
    recallAt8: recallAt(answerable, 8),
    mrr: meanReciprocalRank(answerable),
    ...(() => {
      const scores = abstentionScores(results);
      return {
        abstentionPrecision: scores.precision,
        abstentionRecall: scores.recall,
        falseRefusals: scores.falseRefusals,
      };
    })(),
    misses: answerable
      .filter((item) => item.rank === 0)
      .map((item) => ({ caseId: item.caseId, question: item.question })),
  };
}

/** Formats a report for a terminal, which is where it will usually be read. */
export function formatReport(report: EvalReport) {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    `cases                 ${report.cases}`,
    `recall@1              ${pct(report.recallAt1)}`,
    `recall@5              ${pct(report.recallAt5)}`,
    `recall@8              ${pct(report.recallAt8)}`,
    `MRR                   ${report.mrr.toFixed(3)}`,
    `abstention precision  ${pct(report.abstentionPrecision)}`,
    `abstention recall     ${pct(report.abstentionRecall)}`,
    `false refusals        ${report.falseRefusals}`,
  ];
  if (report.misses.length) {
    lines.push("", `never retrieved (${report.misses.length}):`);
    for (const miss of report.misses.slice(0, 15)) {
      lines.push(`  - ${miss.question}`);
    }
    if (report.misses.length > 15) {
      lines.push(`  ... and ${report.misses.length - 15} more`);
    }
  }
  return lines.join("\n");
}
