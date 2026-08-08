/** Separators a CMS uses between the page title and the site name. */
const TITLE_SEPARATORS = /\s+[|–—]\s+|\s+-\s+/;

/**
 * Strips the trailing site name that most CMSes append to every title.
 *
 * Requiring whitespace around the separator leaves hyphenated words like
 * "Set-up" intact.
 */
export function cleanPageTitle(title: string) {
  const collapsed = title.replace(/\s+/g, " ").trim();
  return (collapsed.split(TITLE_SEPARATORS)[0] ?? collapsed).trim();
}

/**
 * How much of the title the query accounts for, ignoring the site name.
 *
 * `titleScore` asks whether the query's words appear in the title, which
 * cannot tell "Time Calculator" from "Screen Time Calculator" - both contain
 * every word of "time calculator". This asks the opposite question, so a title
 * padded with words the visitor did not ask for ranks below an exact one.
 */
export function titlePrecision(title: string, terms: string[]) {
  if (!terms.length) return 0;
  const words = cleanPageTitle(title)
    .toLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu);
  if (!words?.length) return 0;
  const covered = words.filter((word) =>
    // Substring either way so "calculators" is covered by "calculator".
    terms.some((term) => word.includes(term) || term.includes(word)),
  ).length;
  return covered / words.length;
}
