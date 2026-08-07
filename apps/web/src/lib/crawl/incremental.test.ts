import { describe, expect, it } from "vitest";

/**
 * The reuse decision itself, isolated from the database so the rule can be
 * pinned down: a page is only reused when a document already exists for that
 * exact URL and its content hash is unchanged.
 */
function planReuse(
  existing: Array<{ id: string; canonicalUrl: string; contentHash: string }>,
  crawled: Array<{ url: string; contentHash: string }>,
) {
  const existingByUrl = new Map(existing.map((item) => [item.canonicalUrl, item]));
  const reusedIds = new Set<string>();
  const toEmbed: string[] = [];

  for (const page of crawled) {
    const prior = existingByUrl.get(page.url);
    if (prior && prior.contentHash === page.contentHash) {
      reusedIds.add(prior.id);
      continue;
    }
    toEmbed.push(page.url);
  }
  const stale = existing
    .filter((item) => !reusedIds.has(item.id))
    .map((item) => item.id);
  return { reusedIds: [...reusedIds], toEmbed, stale };
}

const doc = (id: string, url: string, hash: string) => ({
  id,
  canonicalUrl: url,
  contentHash: hash,
});

describe("incremental indexing plan", () => {
  it("reuses every page when nothing changed", () => {
    const existing = [doc("1", "https://x.test/a", "h1"), doc("2", "https://x.test/b", "h2")];
    const plan = planReuse(existing, [
      { url: "https://x.test/a", contentHash: "h1" },
      { url: "https://x.test/b", contentHash: "h2" },
    ]);
    expect(plan.toEmbed).toEqual([]);
    expect(plan.stale).toEqual([]);
    expect(plan.reusedIds).toHaveLength(2);
  });

  it("re-embeds only the page whose content changed", () => {
    const existing = [doc("1", "https://x.test/a", "h1"), doc("2", "https://x.test/b", "h2")];
    const plan = planReuse(existing, [
      { url: "https://x.test/a", contentHash: "h1" },
      { url: "https://x.test/b", contentHash: "CHANGED" },
    ]);
    expect(plan.toEmbed).toEqual(["https://x.test/b"]);
    // The old row for the changed page must go, or the URL would be duplicated.
    expect(plan.stale).toEqual(["2"]);
  });

  it("embeds pages that are new to the site", () => {
    const existing = [doc("1", "https://x.test/a", "h1")];
    const plan = planReuse(existing, [
      { url: "https://x.test/a", contentHash: "h1" },
      { url: "https://x.test/new", contentHash: "h9" },
    ]);
    expect(plan.toEmbed).toEqual(["https://x.test/new"]);
    expect(plan.stale).toEqual([]);
  });

  it("removes pages that vanished from the site", () => {
    const existing = [doc("1", "https://x.test/a", "h1"), doc("2", "https://x.test/gone", "h2")];
    const plan = planReuse(existing, [{ url: "https://x.test/a", contentHash: "h1" }]);
    expect(plan.toEmbed).toEqual([]);
    expect(plan.stale).toEqual(["2"]);
  });

  it("treats a first run as everything to embed", () => {
    const plan = planReuse([], [
      { url: "https://x.test/a", contentHash: "h1" },
      { url: "https://x.test/b", contentHash: "h2" },
    ]);
    expect(plan.toEmbed).toHaveLength(2);
    expect(plan.stale).toEqual([]);
  });

  it("does not reuse a matching hash found at a different URL", () => {
    // Same content moved to a new path still needs its own document row.
    const existing = [doc("1", "https://x.test/old", "same")];
    const plan = planReuse(existing, [{ url: "https://x.test/new", contentHash: "same" }]);
    expect(plan.toEmbed).toEqual(["https://x.test/new"]);
    expect(plan.stale).toEqual(["1"]);
  });
});
