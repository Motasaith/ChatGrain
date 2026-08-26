/**
 * How many pasted URLs one submission may add.
 *
 * Generous, but bounded: this field accepts a paste, and a paste can be a whole
 * spreadsheet column by accident.
 */
const MAX_PASTED = 5_000;

/**
 * Parses a pasted block into URLs, keeping only those on the source's own site.
 *
 * Off-site URLs are dropped rather than rejected. A paste from a spreadsheet
 * routinely carries a stray row, and failing the whole submission over one bad
 * line would be a worse answer than indexing the good ones and saying how many
 * were skipped.
 */
/**
 * The origin a pasted path resolves against.
 *
 * Exported so the interface can show the same thing the parser will do rather
 * than assembling its own guess. It said "/pricing is the same as
 * {rootUrl}/pricing", which on a root stored with a trailing slash rendered
 * https://example.com//pricing - an address that does not exist, printed as an
 * example of correct usage.
 */
export function pasteOrigin(rootUrl: string | null): string | null {
  if (!rootUrl) return null;
  try {
    return new URL(rootUrl).origin;
  } catch {
    return null;
  }
}

export function parsePastedUrls(input: string, rootUrl: string) {
  let origin: string;
  try {
    origin = new URL(rootUrl).origin;
  } catch {
    return { urls: [], skipped: 0 };
  }
  const urls: string[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const rawLine of input.split(/[\r\n]+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let candidate: URL;
    try {
      // A bare path is a reasonable thing to paste when every URL shares a host.
      candidate = new URL(line, `${origin}/`);
    } catch {
      skipped += 1;
      continue;
    }
    if (candidate.origin !== origin) {
      skipped += 1;
      continue;
    }
    candidate.hash = "";
    if (seen.has(candidate.href)) continue;
    seen.add(candidate.href);
    if (urls.length < MAX_PASTED) urls.push(candidate.href);
  }
  return { urls, skipped };
}
