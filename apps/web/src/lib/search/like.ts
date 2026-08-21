/**
 * Turns a typed phrase into a safe `ILIKE` pattern.
 *
 * `%` and `_` are wildcards to SQL and a backslash is the escape character, so
 * a source genuinely named "report_2026" would otherwise also match
 * "reportX2026" - and a visitor typing "%" would match every row in the table.
 */
export function likePattern(query: string) {
  return `%${query.replace(/[%_\\]/g, (character) => `\\${character}`)}%`;
}
