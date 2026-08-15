import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Compares embedding models on the same corpus, questions and retrieval code.
 *
 * Skipped unless MODEL_COMPARE is set: it downloads model weights and takes
 * minutes, which does not belong in the suite that runs before every push.
 *
 *   MODEL_COMPARE=1 npx vitest run src/lib/eval/model-compare.test.ts
 *
 * The point is that only the model varies. Same chunks, same questions, same
 * `hybridRetrieve`, same metrics - so a difference in the numbers is a
 * difference in the model and not in anything else.
 */

let database: ReturnType<typeof drizzle>;
let client: PGlite | undefined;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  get db() {
    return database;
  },
}));

const AGENT = "11111111-1111-1111-1111-111111111111";
const WORKSPACE = "22222222-2222-2222-2222-222222222222";
const SOURCE = "33333333-3333-3333-3333-333333333333";

/** Real prose that already exists in the repo, so no crawl is needed. */
const CORPUS_FILES = [
  ["README.md", "https://docs.test/readme", "Docent README"],
  ["docs/chatbase-parity.md", "https://docs.test/parity", "Chatbase parity"],
  ["Docent_plan/PLAN.md", "https://docs.test/plan", "Accuracy plan"],
  ["Docent_plan/STACK.md", "https://docs.test/stack", "Stack decisions"],
  ["Docent_plan/MIGRATION-GUIDE.md", "https://docs.test/migration", "Migration guide"],
] as const;

const MODELS = [
  {
    label: "EmbeddingGemma-300M",
    model: "onnx-community/embeddinggemma-300m-ONNX",
    dtype: "q4",
    dims: 768,
  },
  {
    label: "bge-small-en-v1.5",
    model: "Xenova/bge-small-en-v1.5",
    dtype: "q8",
    dims: 384,
  },
];

const ROOT = join(process.cwd(), "..", "..");
const CACHE = join(process.cwd(), ".data", "eval");
const QUESTIONS_PATH = join(CACHE, "model-compare-questions.json");
const RESULTS_PATH = join(CACHE, "model-compare-results.json");

type Chunk = { content: string; url: string; title: string; position: number };

function buildCorpus(chunkText: (v: string) => Array<{ content: string; position: number }>) {
  const chunks: Chunk[] = [];
  for (const [file, url, title] of CORPUS_FILES) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const piece of chunkText(text)) {
      chunks.push({ content: piece.content, url, title, position: piece.position });
    }
  }
  return chunks;
}

async function freshDatabase(dims: number, chunks: Chunk[], embed: (t: string[]) => Promise<number[][]>) {
  await client?.close();
  client = await PGlite.create({ extensions: { vector } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  const dir = join(process.cwd(), "drizzle");
  const { readdirSync } = await import("node:fs");
  for (const file of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
  // Each model has its own width; the table is empty, so this is free.
  await client.exec(`DROP INDEX IF EXISTS chunks_embedding_hnsw;`);
  await client.exec(`ALTER TABLE chunks ALTER COLUMN embedding SET DATA TYPE vector(${dims});`);
  await client.exec(
    `CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);`,
  );
  database = drizzle(client);

  await client.exec(`
    insert into workspaces (id, name, slug) values ('${WORKSPACE}', 'Test', 'test');
    insert into agents (id, workspace_id, name) values ('${AGENT}', '${WORKSPACE}', 'Docs');
    insert into sources (id, agent_id, type, name, root_url)
      values ('${SOURCE}', '${AGENT}', 'website', 'docs', 'https://docs.test/');
  `);

  const byUrl = new Map<string, string>();
  for (const [index, [, url, title]] of CORPUS_FILES.entries()) {
    const documentId = `4444444${index}-4444-4444-4444-444444444444`;
    byUrl.set(url, documentId);
    await client.query(
      `insert into documents (id, source_id, canonical_url, title, content_hash)
       values ($1, $2, $3, $4, $5)`,
      [documentId, SOURCE, url, title, `hash-${index}`],
    );
  }

  const ids: string[] = [];
  for (let start = 0; start < chunks.length; start += 16) {
    const batch = chunks.slice(start, start + 16);
    const vectors = await embed(batch.map((c) => c.content));
    for (const [offset, chunk] of batch.entries()) {
      const rows = await client.query<{ id: string }>(
        `insert into chunks (document_id, source_id, agent_id, position, content, token_count, embedding)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [
          byUrl.get(chunk.url),
          SOURCE,
          AGENT,
          chunk.position,
          chunk.content,
          Math.ceil(chunk.content.length / 4),
          JSON.stringify(vectors[offset]),
        ],
      );
      ids.push(rows.rows[0].id);
    }
  }
  return ids;
}

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe.skipIf(!process.env.MODEL_COMPARE)("embedding model comparison", () => {
  it(
    "scores each model on the same corpus and questions",
    async () => {
      // Read .env.local directly rather than via `loadEnvConfig`.
      //
      // Next deliberately ignores `.env.local` when NODE_ENV=test, so that
      // tests cannot depend on one developer's machine. That is the right
      // default and the wrong one here: this comparison needs a real LLM key
      // to write the questions, and without it every call fails silently.
      const envPath = join(process.cwd(), ".env.local");
      if (existsSync(envPath)) {
        for (const raw of readFileSync(envPath, "utf8").split("\n")) {
          const line = raw.trim();
          const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
          if (match && !process.env[match[1]]) {
            process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
          }
        }
      }

      const { chunkText } = await import("@/lib/rag/chunk");
      const corpus = buildCorpus(chunkText);
      expect(corpus.length).toBeGreaterThan(30);
      console.log(`\ncorpus: ${corpus.length} chunks from ${CORPUS_FILES.length} documents`);

      // Questions are generated once and cached, so every model answers the
      // identical set. Regenerating per model would compare question sets as
      // much as models.
      mkdirSync(CACHE, { recursive: true });
      let questions: Array<{ question: string; url: string }>;
      const cached = existsSync(QUESTIONS_PATH)
        ? (JSON.parse(readFileSync(QUESTIONS_PATH, "utf8")) as typeof questions)
        : [];
      // An empty cache is treated as no cache. Writing one on a failed run
      // would otherwise make every later run fail identically and instantly,
      // which reads like a broken comparison rather than a missing API key.
      if (cached.length) {
        questions = cached;
        console.log(`questions: ${questions.length} (cached)`);
      } else {
        process.env.EMBEDDING_PROVIDER = "hash";
        const { generateQuestionsFor } = await import("./golden-set");
        const sample = corpus
          .filter((c) => c.content.length > 400)
          .filter((_, i) => i % 3 === 0)
          .slice(0, 30);
        questions = await generateQuestionsFor(
          sample.map((c) => ({ content: c.content, title: c.title, url: c.url })),
        );
        if (questions.length) {
          writeFileSync(QUESTIONS_PATH, JSON.stringify(questions, null, 2));
        }
        console.log(`questions: ${questions.length} (generated)`);
      }
      expect(questions.length).toBeGreaterThan(5);

      const table: string[] = [];
      const rows: Array<Record<string, unknown>> = [];
      for (const spec of MODELS) {
        vi.resetModules();
        process.env.EMBEDDING_PROVIDER = "local";
        process.env.EMBEDDING_MODEL = spec.model;
        process.env.EMBEDDING_DTYPE = spec.dtype;
        process.env.EMBEDDING_DIMENSIONS = String(spec.dims);
        delete process.env.EMBEDDING_POOLING;

        const { embedTexts } = await import("@/lib/rag/embeddings");
        const started = Date.now();
        await freshDatabase(spec.dims, corpus, (texts) => embedTexts(texts, "document"));
        const indexSeconds = (Date.now() - started) / 1000;

        const { runEval } = await import("./run");
        const report = await runEval(
          AGENT,
          questions.map((q, index) => ({
            id: String(index),
            question: q.question,
            expectedChunkIds: [],
            expectedUrls: [q.url],
          })),
        );
        const line =
          `${spec.label.padEnd(22)} recall@1 ${(report.recallAt1 * 100).toFixed(0).padStart(3)}%  ` +
          `recall@8 ${(report.recallAt8 * 100).toFixed(0).padStart(3)}%  ` +
          `MRR ${report.mrr.toFixed(3)}  ` +
          `index ${indexSeconds.toFixed(0)}s  ` +
          `${(corpus.length / indexSeconds).toFixed(1)} chunks/s`;
        table.push(line);
        rows.push({
          model: spec.label,
          dims: spec.dims,
          recallAt1: report.recallAt1,
          recallAt5: report.recallAt5,
          recallAt8: report.recallAt8,
          mrr: report.mrr,
          indexSeconds: Number(indexSeconds.toFixed(1)),
          chunksPerSecond: Number((corpus.length / indexSeconds).toFixed(2)),
          missedQuestions: report.misses.map((m) => m.question),
        });
        console.log(line);
      }

      // Written to disk as well as logged: vitest swallows stdout under some
      // reporters, and a comparison nobody can read is a comparison nobody ran.
      writeFileSync(
        RESULTS_PATH,
        JSON.stringify(
          { corpusChunks: corpus.length, questions: questions.length, rows },
          null,
          2,
        ),
      );
      console.log("\n" + table.join("\n") + "\n");
      expect(table).toHaveLength(MODELS.length);
    },
    30 * 60_000,
  );
});
