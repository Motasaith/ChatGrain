/**
 * "Support" becomes "Support (copy)", and "Support (copy)" becomes
 * "Support (copy 2)".
 *
 * Copying twice would otherwise produce two agents with identical names, which
 * is exactly the situation the delete confirmation elsewhere warns about:
 * workspaces accumulate near-identical names, and telling them apart afterwards
 * costs somebody an afternoon and occasionally the wrong deletion.
 *
 * In its own module rather than beside the route that uses it. The route reaches
 * the database and therefore imports `server-only`, which makes it unimportable
 * from a test - and this is the part of duplication most worth testing, being
 * pure, fiddly, and wrong in a way nobody notices until there are three copies.
 */
export function copyName(name: string, limit = 80) {
  const numbered = name.match(/^(.*) \(copy(?: (\d+))?\)$/);
  const base = numbered ? numbered[1] : name;
  const next = numbered ? Number(numbered[2] ?? 1) + 1 : 1;
  const suffix = next === 1 ? " (copy)" : ` (copy ${next})`;
  // The name is trimmed, never the suffix: a shortened name with "(copy 2)"
  // intact is still usable, and a full name with the marker cut off is not.
  return `${base.slice(0, Math.max(1, limit - suffix.length))}${suffix}`;
}
