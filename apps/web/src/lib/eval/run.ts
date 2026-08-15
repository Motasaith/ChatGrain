import "server-only";
import { hybridRetrieve } from "@/lib/rag/retrieve";
import {
  firstHitRank,
  summarise,
  type CaseResult,
  type EvalCase,
  type EvalReport,
} from "./metrics";

/**
 * Runs a golden set against live retrieval.
 *
 * Retrieval only - deliberately. Judging the generated answer needs a second
 * LLM call per case and turns a 30-second run into a slow, costly one that
 * nobody runs before pushing. Recall and MRR are where regressions actually
 * show up, because an answer the retriever never surfaced cannot be produced
 * by any prompt. Answer correctness is the next layer, not this one.
 */

export type RunOptions = {
  /** Depth to retrieve. Must be >= the largest k reported, or recall@8 lies. */
  limit?: number;
  onProgress?: (done: number, total: number) => void;
};

export async function runEval(
  agentId: string,
  cases: EvalCase[],
  { limit = 8, onProgress }: RunOptions = {},
): Promise<EvalReport> {
  const results: CaseResult[] = [];
  for (const [index, item] of cases.entries()) {
    const hits = await hybridRetrieve(agentId, item.question, limit);
    results.push({
      caseId: item.id,
      question: item.question,
      rank: firstHitRank(
        hits.map((hit) => ({ chunkId: hit.chunkId, url: hit.url })),
        item,
      ),
      // Retrieval returning nothing is the retrieval-level equivalent of an
      // abstention: the answer path would have had no evidence to work from.
      abstained: hits.length === 0,
      unanswerable: item.unanswerable ?? false,
    });
    onProgress?.(index + 1, cases.length);
  }
  return summarise(results);
}

/**
 * Compares a run against a stored baseline.
 *
 * The build should fail on a recall drop and stay quiet about noise, so the
 * comparison needs a tolerance. Retrieval is deterministic given a fixed index
 * and model, but the index changes on every crawl, so a small band avoids a
 * red build every time a customer edits a page.
 */
export function compareToBaseline(
  current: EvalReport,
  baseline: EvalReport,
  { tolerance = 0.02 }: { tolerance?: number } = {},
) {
  const drop = baseline.recallAt8 - current.recallAt8;
  return {
    regressed: drop > tolerance,
    recallDelta: current.recallAt8 - baseline.recallAt8,
    mrrDelta: current.mrr - baseline.mrr,
    summary:
      drop > tolerance
        ? `recall@8 fell ${(drop * 100).toFixed(1)} points ` +
          `(${(baseline.recallAt8 * 100).toFixed(1)}% -> ${(current.recallAt8 * 100).toFixed(1)}%)`
        : `recall@8 ${(current.recallAt8 * 100).toFixed(1)}% ` +
          `(baseline ${(baseline.recallAt8 * 100).toFixed(1)}%)`,
  };
}
