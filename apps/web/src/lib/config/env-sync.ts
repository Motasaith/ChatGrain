/**
 * Merges a real env file onto the template.
 *
 * The template is the list of every variable, in a readable order, with its
 * comments. A real env file drifts from it: variables get added to the
 * template over time and nobody backfills them, so a default silently applies
 * without ever appearing in the file that is supposed to describe the install.
 *
 * The result keeps the template's structure and the real file's values. It
 * never reads a value out to the caller, so this can run over a file holding
 * production keys without printing any of them.
 */

export type EnvSyncResult = {
  contents: string;
  /** Keys the template introduced that the target did not have. */
  added: string[];
  /** Keys the target had that the template does not mention. */
  extra: string[];
  /** Keys present in both, whose existing value was preserved. */
  kept: string[];
};

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Values only; comments and blanks are structure, not data. */
export function parseEnv(contents: string) {
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = ASSIGNMENT.exec(line.trim());
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

export function syncEnv(template: string, existing: string): EnvSyncResult {
  const current = parseEnv(existing);
  const seen = new Set<string>();
  const added: string[] = [];
  const kept: string[] = [];

  const lines = template.split(/\r?\n/).map((line) => {
    const match = ASSIGNMENT.exec(line.trim());
    if (!match) return line;
    const [, key] = match;
    seen.add(key);
    if (current.has(key)) {
      kept.push(key);
      // The real value wins, including a deliberately empty one: blanking a
      // key is how you turn a feature off, and restoring the template's
      // default would switch it back on behind your back.
      return `${key}=${current.get(key)}`;
    }
    added.push(key);
    return line;
  });

  const extra = [...current.keys()].filter((key) => !seen.has(key));
  if (extra.length) {
    lines.push(
      "",
      "# Set here but absent from .env.example. Either they are deliberate",
      "# local overrides, or the template needs updating.",
      ...extra.map((key) => `${key}=${current.get(key)}`),
    );
  }

  return { contents: lines.join("\n"), added, extra, kept };
}

/**
 * The template equivalent of a real file: same keys and order, no values.
 *
 * Keys whose name marks them as a secret are emptied; everything else keeps
 * its value, because a default is documentation and hiding it makes the
 * template useless.
 */
const SECRET_PATTERN = /(KEY|SECRET|TOKEN|PASSWORD|DSN|SMTP_URL|DATABASE_URL)$/;

export function redactEnv(contents: string) {
  return contents
    .split(/\r?\n/)
    .map((line) => {
      const match = ASSIGNMENT.exec(line.trim());
      if (!match) return line;
      const [, key, value] = match;
      // NEXT_PUBLIC_ values reach the browser, so they are not secrets - but a
      // publishable key still identifies the account, so it is emptied too.
      if (SECRET_PATTERN.test(key) && value.trim()) return `${key}=`;
      return line;
    })
    .join("\n");
}
