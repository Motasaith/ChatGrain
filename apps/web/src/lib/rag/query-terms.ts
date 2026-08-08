/**
 * Query term selection for keyword retrieval.
 *
 * Kept apart from `retrieve.ts` so it stays a pure function: term selection
 * decides more than half of an answer's confidence score, and it needs to be
 * testable without a database.
 */

/**
 * Words that carry no topic in any corpus - English function words and the
 * scaffolding of a question.
 *
 * Site-specific words do NOT belong here. A term that means nothing on one
 * site is the whole query on another, which is why the site's own vocabulary
 * is derived per agent instead.
 */
const GENERIC_STOP_WORDS = new Set([
  "the", "and", "what", "where", "when", "which", "with", "from", "this",
  "that", "you", "your", "our", "are", "was", "were", "will", "does", "its",
  "how", "can", "could", "would", "please", "give", "have", "about", "need",
  "want", "build", "final", "year", "tell", "something", "uses", "using",
  "more", "information", "info", "because", "working", "similar", "related",
  "enlist", "list", "titles", "urls", "article", "articles", "website",
  "site", "know", "looking",
]);

/** Beyond this a query is a paste, not a question. */
const MAX_TERMS = 24;

/**
 * The site's own name, which every page on it matches.
 *
 * Derived from the domain rather than configured, so it works for every
 * customer without anyone having to notice the problem first. Only multi-word
 * labels are split: "projects-raspberry" yields two real words, whereas
 * inventing "calculators" out of "homeofcalculators" would strip the exact
 * term visitors search for.
 */
export function siteStopWords(rootUrls: string[]) {
  const words = new Set<string>();
  for (const rootUrl of rootUrls) {
    let hostname: string;
    try {
      hostname = new URL(rootUrl).hostname;
    } catch {
      continue;
    }
    const labels = hostname
      .replace(/^www\./, "")
      .split(".")
      // The TLD is never a topic word.
      .slice(0, -1);
    for (const label of labels) {
      for (const word of label.split(/[-_]+/)) {
        if (word.length < 3) continue;
        words.add(word);
        // Visitors switch freely between "raspberry project" and "projects",
        // and the keyword index is not stemmed at this stage.
        words.add(word.endsWith("s") ? word.slice(0, -1) : `${word}s`);
      }
    }
  }
  return words;
}

export function retrievalQueryTerms(
  query: string,
  { siteWords }: { siteWords?: Set<string> } = {},
) {
  const raw = [
    ...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []),
  ];

  // Each narrowing is only applied if something survives it. A query stripped
  // to nothing scores zero on both the lexical and title components - 55% of
  // the confidence weight - so every answer to it falls under the grounding
  // threshold and the agent refuses a question it could have answered.
  const withoutGeneric = raw.filter((term) => !GENERIC_STOP_WORDS.has(term));
  const base = withoutGeneric.length ? withoutGeneric : raw;

  if (!siteWords?.size) return base.slice(0, MAX_TERMS);
  const discriminating = base.filter((term) => !siteWords.has(term));
  return (discriminating.length ? discriminating : base).slice(0, MAX_TERMS);
}
