import type { RetrievalHit } from "@/lib/rag/retrieve";

/**
 * Follow-up chips shown under an answer.
 *
 * These are built from the evidence that was already retrieved rather than
 * from a second model call. That keeps the answer fast on a small self-hosted
 * box, and - more importantly - guarantees every suggestion is answerable:
 * a generated question about a page the agent has not indexed would refuse the
 * moment the visitor tapped it, which is worse than showing nothing.
 */

/** Three fits one line on a phone; more wraps into a wall of chips. */
const MAX_SUGGESTIONS = 3;

/**
 * Titles that carry no topic. Navigation and error pages routinely outrank
 * real content on thin queries, and "Home" is not a question anyone means.
 */
const UNUSABLE_TITLES = new Set([
  "home",
  "homepage",
  "index",
  "untitled",
  "404",
  "not found",
  "page not found",
  "error",
  "search",
  "search results",
  "login",
  "sign in",
  "sign up",
  "menu",
  "blog",
  "archive",
  "category",
  "tag",
]);

/** Separators a CMS uses between the page title and the site name. */
const TITLE_SEPARATORS = /\s+[|–—]\s+|\s+-\s+/;

export function cleanSuggestionTitle(title: string) {
  const collapsed = title.replace(/\s+/g, " ").trim();
  const parts = collapsed.split(TITLE_SEPARATORS);
  // The site name is the trailing segment, so keep the leading one. Requiring
  // whitespace around the separator leaves hyphenated words like "Set-up"
  // intact.
  return (parts[0] ?? collapsed).trim();
}

function isUsable(title: string) {
  const lower = title.toLowerCase();
  if (UNUSABLE_TITLES.has(lower)) return false;
  // Bare numbers and single characters read as noise in a chip.
  if (title.length < 3 || /^[\d\s.\-]+$/.test(title)) return false;
  return true;
}

/**
 * Rejects a suggestion that restates the question. Word overlap catches the
 * common case ("what is the refund policy" vs "Refund Policy") without needing
 * the model.
 */
function alreadyAsked(title: string, question: string) {
  const words = title
    .toLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu);
  if (!words?.length) return false;
  const asked = question.toLowerCase();
  return words.every((word) => asked.includes(word));
}

function phraseAsQuestion(title: string) {
  if (title.endsWith("?")) return title;
  return `Tell me about ${title}`;
}

export function suggestFollowUps({
  hits,
  question,
  answeredDocumentIds,
  grounded = true,
}: {
  hits: RetrievalHit[];
  question: string;
  /** Documents the answer already covered; suggesting them adds nothing. */
  answeredDocumentIds: string[];
  grounded?: boolean;
}): string[] {
  if (!grounded) return [];

  const covered = new Set(answeredDocumentIds);
  const seenTitles = new Set<string>();
  const suggestions: string[] = [];

  for (const hit of hits) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    if (covered.has(hit.documentId)) continue;

    const title = cleanSuggestionTitle(hit.title ?? "");
    const key = title.toLowerCase();
    if (!title || seenTitles.has(key)) continue;
    if (!isUsable(title) || alreadyAsked(title, question)) continue;

    seenTitles.add(key);
    suggestions.push(phraseAsQuestion(title));
  }

  return suggestions;
}
