/**
 * Whether a typed confirmation matches the agent being deleted.
 *
 * Deleting cascades to every source, indexed page, conversation, ticket and
 * lead, and workspaces accumulate agents with near-identical names
 * ("FileViewerHub", "FileViewerHub 2.0", "fvh"), so the name is typed rather
 * than clicked through.
 *
 * Matching ignores case and surrounding whitespace: neither adds protection
 * against picking the wrong agent, and both are how a correct answer usually
 * fails.
 */
export function deleteConfirmationMatches(typed: string, agentName: string) {
  const normalise = (value: string) =>
    value.replace(/\s+/g, " ").trim().toLowerCase();
  const expected = normalise(agentName);
  // An unnamed agent would otherwise be deletable with an empty box.
  if (!expected) return false;
  return normalise(typed) === expected;
}
