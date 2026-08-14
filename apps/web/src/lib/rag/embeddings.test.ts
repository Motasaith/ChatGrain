import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env.EMBEDDING_DIMENSIONS = "1024";
  process.env.EMBEDDING_MODEL = "onnx-community/Qwen3-Embedding-0.6B-ONNX";
  // Retries are real behaviour worth testing; waiting out real seconds is not.
  process.env.EMBEDDING_RETRY_BASE_MS = "0";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

function unitVector(length: number, seed = 1) {
  const raw = Array.from({ length }, (_, i) => Math.sin((i + 1) * seed));
  const norm = Math.sqrt(raw.reduce((s, x) => s + x * x, 0));
  return raw.map((x) => x / norm);
}

describe("Cloudflare Workers AI provider", () => {
  beforeEach(() => {
    process.env.EMBEDDING_PROVIDER = "cloudflare";
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_API_TOKEN = "token";
  });

  it("sends the instruction field only for queries", async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(JSON.parse(String(init.body)));
        return {
          ok: true,
          json: async () => ({ result: { data: [unitVector(1024)] } }),
        } as unknown as Response;
      }),
    );
    const { embedText } = await import("./embeddings");

    await embedText("what is the refund policy", "query");
    await embedText("Refunds are accepted within 30 days.", "document");

    // Qwen3 is instruction-aware, and the asymmetry is the point: instructing
    // the document side too would push both vectors toward the instruction
    // rather than toward each other.
    expect(calls[0].instruction).toBeTypeOf("string");
    expect(calls[1].instruction).toBeUndefined();
  });

  it("batches large inputs rather than sending one giant request", async () => {
    process.env.EMBEDDING_BATCH = "4";
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests += 1;
        const body = JSON.parse(String(init.body)) as { text: string[] };
        return {
          ok: true,
          json: async () => ({
            result: { data: body.text.map(() => unitVector(1024)) },
          }),
        } as unknown as Response;
      }),
    );
    const { embedTexts } = await import("./embeddings");

    const vectors = await embedTexts(Array.from({ length: 10 }, (_, i) => `t${i}`));
    expect(requests).toBe(3);
    expect(vectors).toHaveLength(10);
  });

  it("throws rather than silently writing meaningless vectors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "upstream exploded",
      }) as unknown as Response),
    );
    const { embedTexts } = await import("./embeddings");

    // The hash fallback produces vectors that look valid but mean nothing.
    // Indexing those would read as an accuracy collapse, not an outage.
    await expect(embedTexts(["anything"])).rejects.toThrow(/failed after/i);
  });
});

describe("OpenAI-compatible provider", () => {
  beforeEach(() => {
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.EMBEDDING_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.EMBEDDING_API_KEY = "key";
    process.env.EMBEDDING_MODEL_ID = "qwen/qwen3-embedding-8b";
  });

  it("restores the provider's order from the index field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        // Deliberately out of order: the spec permits it, and pairing vectors
        // with the wrong chunk would corrupt the index invisibly.
        json: async () => ({
          data: [
            { index: 1, embedding: unitVector(1024, 2) },
            { index: 0, embedding: unitVector(1024, 1) },
          ],
        }),
      }) as unknown as Response),
    );
    const { embedTexts } = await import("./embeddings");

    const [first] = await embedTexts(["first", "second"]);
    expect(first[0]).toBeCloseTo(unitVector(1024, 1)[0], 10);
  });

  it("re-normalises a truncated Matryoshka vector back to unit length", async () => {
    process.env.EMBEDDING_DIMENSIONS = "256";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: unitVector(1024) }] }),
      }) as unknown as Response),
    );
    const { embedText } = await import("./embeddings");

    const vector = await embedText("hello");
    expect(vector).toHaveLength(256);
    // Cosine distance assumes unit length; a truncated vector is not, so
    // skipping this makes every similarity score quietly wrong.
    const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });
});

describe("hash provider", () => {
  it("stays deterministic and correctly sized", async () => {
    process.env.EMBEDDING_PROVIDER = "hash";
    const { embedText } = await import("./embeddings");
    const a = await embedText("same text");
    const b = await embedText("same text");
    expect(a).toHaveLength(1024);
    expect(a).toEqual(b);
  });
});
