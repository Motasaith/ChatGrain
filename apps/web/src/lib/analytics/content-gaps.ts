/**
 * Groups the questions an agent could not answer.
 *
 * A raw list is close to useless: the same gap arrives twenty times worded
 * twenty ways, and the one asked most often looks identical to a one-off
 * typo. Grouping is what turns the list into a ranked to-do.
 */

export type UnansweredQuestion = {
  question: string;
  askedAt: Date;
  conversationId: string;
  agentName: string;
};

export type ContentGap = {
  /** The most complete phrasing seen, which reads best in the UI. */
  question: string;
  count: number;
  lastAskedAt: Date;
  agentName: string;
  /** A conversation to open, so the gap can be read in context. */
  conversationId: string;
  /** Other phrasings, for deciding what a pinned answer should cover. */
  variants: string[];
};

/**
 * Question framing that carries no topic.
 *
 * Without this, "how do I cancel" and "can you tell me how to cancel" land in
 * different groups purely because one is more polite.
 */
const FRAMING = new Set([
  "the", "a", "an", "is", "are", "do", "does", "did", "can", "could", "would",
  "will", "how", "what", "where", "when", "why", "who", "i", "me", "my", "we",
  "our", "you", "your", "to", "of", "for", "in", "on", "at", "and", "or", "it",
  "this", "that", "there", "please", "tell", "know", "want", "need", "help",
  "about", "with", "from", "any", "some", "get", "have", "has", "was", "were",
]);

/**
 * A key that collapses wording differences but not topics.
 *
 * Sorting the terms means word order stops mattering, so "cancel subscription"
 * and "subscription cancel" group together.
 */
export function questionKey(question: string) {
  const terms = (question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    .filter((term) => !FRAMING.has(term))
    // Crude plural stripping: "refunds" and "refund" are the same gap.
    .map((term) => (term.length > 4 && term.endsWith("s") ? term.slice(0, -1) : term));
  const unique = [...new Set(terms)].sort();
  // Nothing distinctive left: fall back to the whole question so unrelated
  // one-word queries are not all merged into a single empty group.
  if (!unique.length) return question.toLowerCase().replace(/\s+/g, " ").trim();
  return unique.join(" ");
}

export function groupContentGaps(
  questions: UnansweredQuestion[],
  limit = 25,
): ContentGap[] {
  const groups = new Map<string, UnansweredQuestion[]>();
  for (const item of questions) {
    const trimmed = item.question.trim();
    if (!trimmed) continue;
    const key = questionKey(trimmed);
    const existing = groups.get(key);
    if (existing) existing.push({ ...item, question: trimmed });
    else groups.set(key, [{ ...item, question: trimmed }]);
  }

  return [...groups.values()]
    .map((items) => {
      const newest = items.reduce((latest, item) =>
        item.askedAt > latest.askedAt ? item : latest,
      );
      // The longest phrasing usually reads best as a heading; the shortest is
      // often a fragment that lost the point.
      const clearest = items.reduce((best, item) =>
        item.question.length > best.question.length ? item : best,
      );
      return {
        question: clearest.question,
        count: items.length,
        lastAskedAt: newest.askedAt,
        agentName: newest.agentName,
        conversationId: newest.conversationId,
        variants: [
          ...new Set(
            items
              .map((item) => item.question)
              .filter((text) => text !== clearest.question),
          ),
        ].slice(0, 4),
      };
    })
    .sort(
      (a, b) =>
        b.count - a.count || b.lastAskedAt.getTime() - a.lastAskedAt.getTime(),
    )
    .slice(0, limit);
}
