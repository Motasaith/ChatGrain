import { describe, expect, it } from "vitest";

/**
 * The de-duplication `flushPageEvents` performs before its upsert.
 *
 * Extracted here as the rule rather than the code, because the reason it exists
 * is a database constraint rather than anything visible in the function:
 * Postgres refuses an ON CONFLICT DO UPDATE that would touch the same row twice
 * - "cannot affect row a second time" - and it refuses the entire statement.
 * One repeated URL therefore destroyed a whole batch of page events, silently,
 * because the caller catches and logs rather than failing the crawl.
 */
function dedupeByUrl<T extends { url: string }>(rows: T[]) {
  return Array.from(new Map(rows.map((row) => [row.url, row])).values());
}

const row = (url: string, outcome: string, sequence: number) => ({
  url,
  outcome,
  sequence,
});

describe("page event batching", () => {
  it("leaves a batch of distinct URLs alone", () => {
    const rows = [row("/a", "indexed", 1), row("/b", "indexed", 2)];
    expect(dedupeByUrl(rows)).toHaveLength(2);
  });

  it("collapses a URL recorded twice in one window", () => {
    const rows = [row("/a", "redirected", 1), row("/a", "indexed", 2)];
    expect(dedupeByUrl(rows)).toHaveLength(1);
  });

  // Last wins, because the last thing recorded is the page's current state. A
  // redirect noticed first and the indexing of where it landed second must end
  // as "indexed", not as "redirected".
  it("keeps the most recent state for a repeated URL", () => {
    const rows = [row("/a", "redirected", 1), row("/a", "indexed", 2)];
    expect(dedupeByUrl(rows)[0]).toMatchObject({ outcome: "indexed", sequence: 2 });
  });

  it("preserves the order the URLs were first seen in", () => {
    const rows = [row("/a", "indexed", 1), row("/b", "indexed", 2), row("/a", "thin", 3)];
    expect(dedupeByUrl(rows).map((r) => r.url)).toEqual(["/a", "/b"]);
  });

  it("handles a batch that is entirely one URL", () => {
    const rows = [row("/a", "failed", 1), row("/a", "failed", 2), row("/a", "indexed", 3)];
    const out = dedupeByUrl(rows);
    expect(out).toHaveLength(1);
    expect(out[0].outcome).toBe("indexed");
  });
});
