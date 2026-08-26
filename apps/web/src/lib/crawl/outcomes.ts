/**
 * Outcomes that mean the page was actually read, as opposed to merely known.
 *
 * The distinction decides whether a resumed crawl fetches a URL again, so it
 * has to be exact. "discovered" is the trap: discovery writes a row for every
 * URL it finds, stamped with the job that found it, and those rows record that
 * a URL exists - not that anything has been read from it. Treating them as
 * fetched made an approved crawl skip its entire list and fail with "no useful
 * public text", because every page it meant to fetch looked like one it had
 * already done.
 */
const FETCHED_OUTCOMES = new Set([
  "indexed",
  "unchanged",
  "duplicate",
  "thin",
  "redirected",
]);

export function wasFetched(outcome: string) {
  return FETCHED_OUTCOMES.has(outcome);
}
