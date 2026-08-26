import { describe, expect, it } from "vitest";

/**
 * The evidence-selection rule for overview questions, as a rule.
 *
 * "One chunk per page" is right for a specific question and exactly wrong for
 * "list everything": measured on a real site, the nine category pages that
 * between them hold all twenty-three viewers each contributed one chunk out of
 * five or six, and the model was asked to enumerate a list from a fifth of it.
 *
 * Breadth still comes first - which pages appear is decided exactly as before -
 * and the remaining budget is spent evenly across those pages rather than
 * first-come, so the top-ranked page cannot eat the allowance and leave the
 * rest as single fragments.
 */
function selectOverviewEvidence<T extends { documentId: string }>(
  hits: T[],
  { pages, chunks, perPage }: { pages: number; chunks: number; perPage: number },
) {
  const pageOrder: string[] = [];
  const byPage = new Map<string, T[]>();
  for (const hit of hits) {
    const existing = byPage.get(hit.documentId);
    if (existing) {
      existing.push(hit);
      continue;
    }
    if (pageOrder.length >= pages) continue;
    pageOrder.push(hit.documentId);
    byPage.set(hit.documentId, [hit]);
  }
  const chosen: T[] = [];
  for (let depth = 0; depth < perPage; depth += 1) {
    for (const id of pageOrder) {
      const hit = byPage.get(id)?.[depth];
      if (!hit) continue;
      chosen.push(hit);
      if (chosen.length >= chunks) break;
    }
    if (chosen.length >= chunks) break;
  }
  return pageOrder.flatMap((id) => chosen.filter((h) => h.documentId === id));
}

const hit = (documentId: string, n: number) => ({ documentId, n });
const OPTS = { pages: 3, chunks: 8, perPage: 4 };

describe("overview evidence selection", () => {
  it("keeps the page ranking that breadth-first produced", () => {
    const hits = [hit("a", 1), hit("b", 1), hit("c", 1), hit("a", 2)];
    const out = selectOverviewEvidence(hits, OPTS);
    expect([...new Set(out.map((h) => h.documentId))]).toEqual(["a", "b", "c"]);
  });

  // The whole point: a page must be able to contribute more than one chunk.
  it("takes several chunks from one page", () => {
    const hits = [hit("a", 1), hit("a", 2), hit("a", 3), hit("b", 1)];
    const out = selectOverviewEvidence(hits, OPTS);
    expect(out.filter((h) => h.documentId === "a")).toHaveLength(3);
  });

  // Spread evenly, not first-come. A page with ten chunks must not consume the
  // budget and leave every other page as a single fragment - that is the shape
  // this exists to fix, reappearing one level down.
  it("does not let one page eat the budget", () => {
    const hits = [
      ...Array.from({ length: 10 }, (_, i) => hit("a", i)),
      hit("b", 1),
      hit("c", 1),
    ];
    const out = selectOverviewEvidence(hits, { pages: 3, chunks: 4, perPage: 4 });
    expect(out.filter((h) => h.documentId === "a").length).toBeLessThanOrEqual(2);
    expect(out.map((h) => h.documentId)).toContain("b");
    expect(out.map((h) => h.documentId)).toContain("c");
  });

  it("respects the page cap", () => {
    const hits = ["a", "b", "c", "d", "e"].map((d) => hit(d, 1));
    const out = selectOverviewEvidence(hits, OPTS);
    expect(new Set(out.map((h) => h.documentId)).size).toBe(3);
  });

  it("respects the total chunk cap", () => {
    const hits = ["a", "b", "c"].flatMap((d) =>
      Array.from({ length: 5 }, (_, i) => hit(d, i)),
    );
    expect(selectOverviewEvidence(hits, OPTS)).toHaveLength(8);
  });

  it("groups a page's chunks together for the model to read", () => {
    const hits = [hit("a", 1), hit("b", 1), hit("a", 2), hit("b", 2)];
    const out = selectOverviewEvidence(hits, OPTS).map((h) => h.documentId);
    expect(out).toEqual(["a", "a", "b", "b"]);
  });

  it("handles a single page with a single chunk", () => {
    expect(selectOverviewEvidence([hit("a", 1)], OPTS)).toHaveLength(1);
  });
});
