/**
 * The choices offered for "how many pages should this crawl cover".
 *
 * One list, because there were two and they had drifted. Creating an agent
 * offered 100, 500, 1,000, 2,500, 5,000 and the whole site; adding a website to
 * an existing agent offered 100 and 500. Same decision, same ceiling, different
 * menus - and the shorter one was the screen people use more often, since an
 * agent is created once and given sources repeatedly.
 *
 * The steps are round numbers rather than a free-text box on purpose. The
 * figure decides how long a crawl runs and how much of somebody's allowance it
 * spends, and "1,000" is a decision where "1,047" is a typo.
 */

/** Fixed rungs, in order. Anything at or above the ceiling is dropped. */
const STEPS = [100, 500, 1_000, 2_500, 5_000] as const;

export type PageLimitOption = { value: number; label: string };

/**
 * Options up to and including this user's ceiling.
 *
 * `crawlLimit` already accounts for who is asking - `crawlPageLimit(isAdmin)`
 * returns the administrator ceiling or the ordinary one, and the API enforces
 * the same figure again on the way in. So nothing here needs to know about
 * roles, and the studio's second `isAdmin` check was hiding the top option from
 * ordinary users who were entitled to it: they could choose the whole site
 * while creating an agent and not while adding a source to one.
 */
export function pageLimitOptions(crawlLimit: number): PageLimitOption[] {
  const ceiling = Math.max(1, Math.floor(crawlLimit));
  return [
    ...STEPS.filter((value) => value < ceiling).map((value) => ({
      value,
      label: `${value.toLocaleString()} pages`,
    })),
    // Always last, and always the ceiling, so the largest choice is described
    // by what it means rather than by a number nobody chose.
    {
      value: ceiling,
      label: `Entire site (up to ${ceiling.toLocaleString()} pages)`,
    },
  ];
}
