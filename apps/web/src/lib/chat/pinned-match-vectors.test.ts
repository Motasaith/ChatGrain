import { describe, expect, it } from "vitest";
import {
  PINNED_SEMANTIC_THRESHOLD,
  bestPinnedMatch,
  cosineSimilarity,
  needsSemanticCheck,
  type PinnedCandidate,
} from "./pinned-match";

/**
 * Matching a pinned answer on meaning as well as on words.
 *
 * The property that matters most is that this can only ever *add* matches. A
 * pinned answer is returned instead of running retrieval, so getting it wrong
 * does not put a bad answer beside a good one - it replaces the good one, and
 * the only evidence is a customer saying the bot answered something else. So
 * the tests below are mostly about the semantic path staying quiet, and about
 * the word path behaving exactly as it did before.
 */

/** A stand-in scorer, so these tests do not depend on the real tokeniser. */
const exactWords = (question: string, candidate: string) =>
  question.trim().toLowerCase() === candidate.trim().toLowerCase() ? 1 : 0;

const unit = (values: number[]) => {
  const norm = Math.hypot(...values);
  return values.map((value) => value / norm);
};

const pin = (over: Partial<PinnedCandidate> = {}): PinnedCandidate => ({
  id: "pin-1",
  title: "Owner",
  answer: "Rauf",
  questions: ["Who is the owner of this website?"],
  ...over,
});

describe("cosineSimilarity", () => {
  it("is one for the same direction", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    // Magnitude must not matter; only direction.
    expect(cosineSimilarity([1, 0, 0], [7, 0, 0])).toBeCloseTo(1);
  });

  it("is zero for perpendicular vectors and negative for opposite ones", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("refuses mismatched or empty vectors rather than guessing", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    expect(cosineSimilarity([], [1])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});

describe("matching a pinned answer", () => {
  const options = { scoreWords: exactWords, wordThreshold: 0.72 };

  it("still matches on words alone, with no embedding at all", () => {
    const match = bestPinnedMatch(
      "Who is the owner of this website?",
      [pin()],
      options,
    );
    expect(match?.matchedBy).toBe("words");
    expect(match?.answer).toBe("Rauf");
  });

  /**
   * The case the tester reported: same intent, different words. Word overlap
   * scores this at zero here, so only the semantic path can find it.
   */
  it("matches a rephrasing that shares no scored words", () => {
    const asked = unit([1, 0.02, 0]);
    const stored = unit([1, 0, 0.02]);
    const match = bestPinnedMatch("who owns this site", [pin({ questionVectors: [stored] })], {
      ...options,
      questionEmbedding: asked,
    });
    expect(match?.matchedBy).toBe("meaning");
    expect(match?.score).toBeGreaterThanOrEqual(PINNED_SEMANTIC_THRESHOLD);
  });

  it("stays quiet when the meaning is merely related", () => {
    // Around 0.7 - the band where two questions are about the same topic but
    // are not the same question.
    const asked = unit([1, 0, 0]);
    const stored = unit([1, 1, 0]);
    expect(cosineSimilarity(asked, stored)).toBeLessThan(
      PINNED_SEMANTIC_THRESHOLD,
    );
    expect(
      bestPinnedMatch("something else entirely", [pin({ questionVectors: [stored] })], {
        ...options,
        questionEmbedding: asked,
      }),
    ).toBeNull();
  });

  it("ignores vectors when no question embedding was produced", () => {
    // The embedding provider was down. The pin must behave as it did before
    // embeddings existed rather than failing the message.
    expect(
      bestPinnedMatch("who owns this site", [pin({ questionVectors: [unit([1, 0, 0])] })], {
        ...options,
        questionEmbedding: null,
      }),
    ).toBeNull();
  });

  it("ignores a pin that has no vectors stored", () => {
    expect(
      bestPinnedMatch("who owns this site", [pin()], {
        ...options,
        questionEmbedding: unit([1, 0, 0]),
      }),
    ).toBeNull();
  });

  /**
   * The two scores are on different scales, so they are ranked by how far each
   * clears its own bar. Comparing the raw numbers would let word overlap - which
   * reaches 1.0 easily - beat a strong semantic match every time.
   */
  it("ranks by margin over each threshold, not by raw score", () => {
    const asked = unit([1, 0, 0]);
    const match = bestPinnedMatch(
      "exact words",
      [
        // Clears 0.72 by 0.03.
        { ...pin({ id: "weak-words" }), questions: ["exact words"] },
        // Clears 0.86 by 0.14.
        pin({ id: "strong-meaning", questions: ["x"], questionVectors: [asked] }),
      ],
      {
        ...options,
        scoreWords: (question, candidate) =>
          question === candidate ? 0.75 : 0,
        questionEmbedding: asked,
      },
    );
    expect(match?.id).toBe("strong-meaning");
  });

  it("returns nothing when there are no pins", () => {
    expect(bestPinnedMatch("anything", [], options)).toBeNull();
  });
});

describe("deciding whether to embed at all", () => {
  const score = exactWords;

  it("does not embed when no pin has vectors", () => {
    expect(needsSemanticCheck("who owns this", [pin()], score, 0.72)).toBe(
      false,
    );
  });

  it("does not embed when words already match", () => {
    expect(
      needsSemanticCheck(
        "Who is the owner of this website?",
        [pin({ questionVectors: [[1, 0, 0]] })],
        score,
        0.72,
      ),
    ).toBe(false);
  });

  it("embeds only when the cheap path failed and vectors exist", () => {
    expect(
      needsSemanticCheck(
        "who owns this site",
        [pin({ questionVectors: [[1, 0, 0]] })],
        score,
        0.72,
      ),
    ).toBe(true);
  });
});
