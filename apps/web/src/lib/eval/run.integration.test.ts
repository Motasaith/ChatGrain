import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The harness against real retrieval.
 *
 * The unit tests prove the arithmetic; they cannot prove that a golden set,
 * `hybridRetrieve` and the metrics agree on what a "hit" is. That seam is
 * where a harness silently reports nonsense - a chunk id format mismatch, or a
 * limit lower than the k being reported, would make every case a miss and look
 * exactly like a genuine accuracy collapse.
 */

let database: ReturnType<typeof drizzle>;
let client: PGlite;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  get db() {
    return database;
  },
}));

/** Same deterministic stand-in the retrieval fixture uses: no model download. */
const FUNCTION_WORDS = new Set([
  "how", "does", "do", "the", "and", "or", "of", "for", "to", "in", "on",
  "is", "are", "it", "you", "your", "what", "where", "a", "an", "i", "can",
]);

function fakeEmbedding(text: string) {
  const dims = new Array(768).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (FUNCTION_WORDS.has(word)) continue;
    let hash = 0;
    for (let i = 0; i < word.length; i += 1) {
      hash = (hash * 31 + word.charCodeAt(i)) | 0;
    }
    dims[Math.abs(hash) % 768] += 1;
  }
  const norm = Math.sqrt(dims.reduce((s, x) => s + x * x, 0));
  return norm ? dims.map((x) => x / norm) : dims;
}

vi.mock("@/lib/rag/embeddings", () => ({
  embedText: async (text: string) => fakeEmbedding(text),
  embedTexts: async (texts: string[]) => texts.map(fakeEmbedding),
}));

const AGENT = "11111111-1111-1111-1111-111111111111";
const WORKSPACE = "22222222-2222-2222-2222-222222222222";
const SOURCE = "33333333-3333-3333-3333-333333333333";

const CORPUS = [
  {
    title: "Refund Policy",
    url: "https://shop.test/refunds",
    body: "Returns are accepted within 30 days of delivery for a full refund. Start a return from your account page and we process it in five working days.",
  },
  {
    title: "Shipping Times",
    url: "https://shop.test/shipping",
    body: "Standard delivery arrives in three to five working days. Express delivery arrives the next working day when ordered before noon.",
  },
  {
    title: "Battery Care Guide",
    url: "https://shop.test/battery-care",
    body: "Store lithium cells at forty percent charge in a cool place. Avoid discharging below ten percent, which shortens the usable lifespan.",
  },
];

async function applyMigrations(pg: PGlite) {
  const dir = join(process.cwd(), "drizzle");
  for (const file of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const statement of text.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await pg.exec(trimmed);
    }
  }
}

beforeAll(async () => {
  client = await PGlite.create({ extensions: { vector } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  await applyMigrations(client);
  database = drizzle(client);

  await client.exec(`
    insert into workspaces (id, name, slug) values ('${WORKSPACE}', 'Test', 'test');
    insert into agents (id, workspace_id, name) values ('${AGENT}', '${WORKSPACE}', 'Shop');
    insert into sources (id, agent_id, type, name, root_url)
      values ('${SOURCE}', '${AGENT}', 'website', 'site', 'https://shop.test/');
  `);

  for (const [index, page] of CORPUS.entries()) {
    const documentId = `4444444${index}-4444-4444-4444-444444444444`;
    const content = `${page.title}. ${page.body}`;
    await client.query(
      `insert into documents (id, source_id, canonical_url, title, content_hash)
       values ($1, $2, $3, $4, $5)`,
      [documentId, SOURCE, page.url, page.title, `hash-${index}`],
    );
    await client.query(
      `insert into chunks (document_id, source_id, agent_id, position, content, token_count, embedding)
       values ($1, $2, $3, 0, $4, $5, $6)`,
      [documentId, SOURCE, AGENT, content, 40, JSON.stringify(fakeEmbedding(content))],
    );
  }
}, 120_000);

afterAll(async () => {
  await client?.close();
});

describe("eval harness", () => {
  it("scores a set of answerable questions against live retrieval", async () => {
    const { runEval } = await import("./run");
    const report = await runEval(AGENT, [
      {
        id: "refund",
        question: "how do I return something and get my money back",
        expectedChunkIds: [],
        expectedUrls: ["https://shop.test/refunds"],
      },
      {
        id: "shipping",
        question: "how long does delivery take",
        expectedChunkIds: [],
        expectedUrls: ["https://shop.test/shipping"],
      },
    ]);
    expect(report.cases).toBe(2);
    expect(report.recallAt8).toBe(1);
    // Matching by URL has to work end to end: re-indexing mints new chunk ids,
    // so a set pinned only to ids would collapse after every crawl.
    expect(report.misses).toEqual([]);
  }, 60_000);

  it("reports a miss rather than throwing when nothing matches", async () => {
    const { runEval } = await import("./run");
    const report = await runEval(AGENT, [
      {
        id: "absent",
        question: "what is the chief executive's dog called",
        expectedChunkIds: ["no-such-chunk"],
        expectedUrls: ["https://shop.test/nowhere"],
      },
    ]);
    expect(report.recallAt8).toBe(0);
    expect(report.misses).toHaveLength(1);
  }, 60_000);

  it("keeps unanswerable cases out of the retrieval numbers", async () => {
    // Otherwise recall is dragged down by the share of deliberately
    // unanswerable cases, and two golden sets stop being comparable.
    const { runEval } = await import("./run");
    const report = await runEval(AGENT, [
      {
        id: "refund",
        question: "how do I return something and get my money back",
        expectedChunkIds: [],
        expectedUrls: ["https://shop.test/refunds"],
      },
      {
        id: "unanswerable",
        question: "what is the chief executive's dog called",
        expectedChunkIds: [],
        unanswerable: true,
      },
    ]);
    expect(report.cases).toBe(2);
    expect(report.recallAt8).toBe(1);
  }, 60_000);

  it("retrieves at least as deep as the largest k it reports", async () => {
    // A limit below 8 would silently cap recall@8 at the limit and read as an
    // accuracy problem rather than a harness bug.
    const { runEval } = await import("./run");
    const report = await runEval(
      AGENT,
      [
        {
          id: "battery",
          question: "how should lithium cells be stored",
          expectedChunkIds: [],
          expectedUrls: ["https://shop.test/battery-care"],
        },
      ],
      { limit: 8 },
    );
    expect(report.recallAt8).toBe(1);
  }, 60_000);
});
