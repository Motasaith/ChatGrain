/**
 * Deciding whether a pinned answer is the answer to what was asked.
 *
 * Pure, and separate from `answer.ts`, so the thresholds below can be exercised
 * against real phrasings without a database or an embedding provider.
 *
 * The word-overlap scorer is *passed in* rather than reimplemented here. It
 * depends on `answer.ts`'s stop-word list and singulariser, and a second copy
 * of it - even a close one - would score differently from the original the
 * first time either was tuned. Importing it the other way would make a cycle,
 * so it arrives as an argument.
 *
 * ## Why not simply ask a model
 *
 * The obvious reading of "understand the intent" is to send the question and
 * the pinned variations to an LLM and ask which one matches. That was rejected
 * for three reasons, all of them consequences of this running on every single
 * message a visitor sends:
 *
 * - **Latency.** A round trip before the answer can even begin, on the path
 *   somebody is watching a cursor blink on.
 * - **Cost.** One call per message, the vast majority of which match nothing.
 * - **Determinism.** The same question would not reliably reach the same pin -
 *   and a pinned answer exists precisely because somebody wanted one exact
 *   reply to one kind of question.
 *
 * Embeddings give the same understanding of intent, from the model family
 * already indexing this customer's pages, at a fraction of the cost and with a
 * stable answer. "Who owns this site" and "Who is the owner of this website?"
 * land together because they mean the same thing, not because they share words.
 */

/**
 * The bar for a match on meaning rather than on words.
 *
 * Deliberately high. A pinned answer is returned *instead of* running
 * retrieval, so a false positive does not add a wrong answer beside a right one
 * - it replaces the right one, silently, and the only evidence is a customer
 * saying the bot answered something else.
 *
 * On normalised embeddings, genuine paraphrases of a short question sit around
 * 0.85 to 0.95; questions on the same topic asking different things sit around
 * 0.6 to 0.8; unrelated text sits below 0.5. 0.86 is inside the first band with
 * a little room.
 *
 * This number has been reasoned about, not measured against this installation's
 * own pins and traffic. It is the first thing to tune if pins start firing when
 * they should not.
 */
export const PINNED_SEMANTIC_THRESHOLD = 0.86;

/**
 * Cosine similarity between two vectors.
 *
 * The magnitudes are computed rather than assumed to be one. `embedTexts`
 * normalises for the local provider, but a remote one is only as normalised as
 * its API claims, and a silently un-normalised vector would push every score
 * towards the threshold instead of failing visibly.
 */
export function cosineSimilarity(a: number[], b: number[]) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude ? dot / magnitude : 0;
}

export type PinnedCandidate = {
  id: string;
  title: string;
  answer: string;
  questions: string[];
  questionVectors?: number[][] | null;
};

export type PinnedMatch = {
  id: string;
  title: string;
  answer: string;
  /** Which signal cleared its bar, for the log and for chasing a false hit. */
  matchedBy: "words" | "meaning";
  score: number;
};

/** How the two signals are scored and what each has to beat. */
export type PinnedMatchOptions = {
  scoreWords: (question: string, candidate: string) => number;
  wordThreshold: number;
  questionEmbedding?: number[] | null;
  semanticThreshold?: number;
};

/**
 * The best pinned answer for a question, or nothing.
 *
 * Either signal can carry a match on its own, and that asymmetry is the whole
 * design: adding the semantic path can only make more questions find their pin,
 * never fewer. Every phrasing that matched on words yesterday still matches.
 */
export function bestPinnedMatch(
  question: string,
  entries: PinnedCandidate[],
  {
    scoreWords,
    wordThreshold,
    questionEmbedding,
    semanticThreshold = PINNED_SEMANTIC_THRESHOLD,
  }: PinnedMatchOptions,
): PinnedMatch | null {
  let best: PinnedMatch | null = null;
  let bestMargin = -Infinity;

  const consider = (
    entry: PinnedCandidate,
    score: number,
    matchedBy: PinnedMatch["matchedBy"],
    threshold: number,
  ) => {
    if (score < threshold) return;
    // Ranked by how far each score clears its own bar, because the two are not
    // on the same scale: 0.9 of cosine and 0.9 of word overlap do not mean the
    // same thing, and comparing the raw numbers would let the more generous
    // scale win every time.
    const margin = score - threshold;
    if (margin <= bestMargin) return;
    bestMargin = margin;
    best = {
      id: entry.id,
      title: entry.title,
      answer: entry.answer,
      matchedBy,
      score,
    };
  };

  for (const entry of entries) {
    for (const candidate of entry.questions) {
      consider(entry, scoreWords(question, candidate), "words", wordThreshold);
    }

    if (!questionEmbedding?.length) continue;
    for (const vector of entry.questionVectors ?? []) {
      consider(
        entry,
        cosineSimilarity(questionEmbedding, vector),
        "meaning",
        semanticThreshold,
      );
    }
  }

  return best;
}

/**
 * Whether the cheap path has already settled it.
 *
 * Decides if an embedding is worth the round trip. A clear word-overlap match
 * needs no help, and an agent whose pins have no vectors cannot use one - so
 * the expensive signal is reached only when the outcome is genuinely in doubt,
 * which on most messages it is not.
 */
export function needsSemanticCheck(
  question: string,
  entries: PinnedCandidate[],
  scoreWords: (question: string, candidate: string) => number,
  wordThreshold: number,
) {
  if (!entries.some((entry) => entry.questionVectors?.length)) return false;
  return !entries.some((entry) =>
    entry.questions.some(
      (candidate) => scoreWords(question, candidate) >= wordThreshold,
    ),
  );
}
