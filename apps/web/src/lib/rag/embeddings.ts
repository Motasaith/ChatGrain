import { logger } from "@/lib/observability/logger";

/**
 * Vector width. Must match `chunks.embedding` in the schema, and pgvector will
 * not build an HNSW index above 2,000, so this is also a hard ceiling on model
 * choice. EmbeddingGemma emits 768 and Matryoshka-truncates to 512/256/128;
 * truncation shrinks the index but does not speed up inference, since the
 * transformer does the same work either way.
 */
const DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS?.trim()) || 768;

const MODEL =
  process.env.EMBEDDING_MODEL ?? "onnx-community/embeddinggemma-300m-ONNX";

/**
 * Per-family defaults for the two settings that a model dictates rather than
 * invites you to choose: how token vectors are pooled into one, and what
 * prefix each side of the pair carries.
 *
 * Both fail *silently*. Wrong pooling still returns a plausible unit vector;
 * a missing prefix still retrieves something. Neither throws, so the only
 * symptom is retrieval that is quietly worse than it should be - which is why
 * they are written down per model instead of left to a single global default.
 */
const FAMILIES: Array<{
  match: RegExp;
  pooling: "mean" | "cls" | "last_token";
  query: string;
  document: string;
}> = [
  {
    // EmbeddingGemma asks for a task-typed prefix on both sides.
    match: /embeddinggemma|gemma-embed/i,
    pooling: "mean",
    query: "task: search result | query: ",
    document: "title: none | text: ",
  },
  {
    // Qwen3-Embedding is instruction-aware and pools on the final token.
    match: /qwen/i,
    pooling: "last_token",
    query:
      "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:",
    document: "",
  },
  {
    match: /arctic-embed/i,
    pooling: "cls",
    query: "query: ",
    document: "",
  },
  {
    match: /bge-/i,
    pooling: "cls",
    query: "Represent this sentence for searching relevant passages: ",
    document: "",
  },
  {
    match: /e5-/i,
    pooling: "mean",
    query: "query: ",
    document: "passage: ",
  },
];

const FAMILY = FAMILIES.find((entry) => entry.match.test(MODEL));

const POOLING = (process.env.EMBEDDING_POOLING?.trim() ||
  FAMILY?.pooling ||
  "mean") as "mean" | "cls" | "last_token";

const QUERY_PREFIX = process.env.EMBEDDING_QUERY_PREFIX ?? FAMILY?.query ?? "";
const DOCUMENT_PREFIX =
  process.env.EMBEDDING_DOCUMENT_PREFIX ?? FAMILY?.document ?? "";

const DTYPE = process.env.EMBEDDING_DTYPE?.trim() || "q8";

/** Sent to providers that take the instruction as a field, not a prefix. */
const QUERY_INSTRUCTION =
  "Given a web search query, retrieve relevant passages that answer the query";

export type EmbeddingKind = "document" | "query";

function decorate(text: string, kind: EmbeddingKind) {
  // The asymmetry is the point: prefixing documents with the *query* framing
  // would pull both vectors toward the framing instead of toward each other.
  return (kind === "query" ? QUERY_PREFIX : DOCUMENT_PREFIX) + text;
}

type Extractor = (
  input: string[],
  options: { pooling: string; normalize: true },
) => Promise<{ tolist(): number[][] }>;

let extractorPromise: Promise<Extractor> | undefined;

async function loadExtractor() {
  if (!extractorPromise) {
    extractorPromise = import("@huggingface/transformers").then(
      async ({ env, pipeline }) => {
        env.cacheDir = process.env.MODEL_CACHE_DIR ?? ".cache/models";
        const extractor = await pipeline("feature-extraction", MODEL, {
          dtype: DTYPE as "q8",
        });
        logger.info(
          { model: MODEL, pooling: POOLING, dtype: DTYPE, dims: DIMENSIONS },
          "Local embedding model loaded",
        );
        return extractor as unknown as Extractor;
      },
    );
  }
  return extractorPromise;
}

function stableFallbackEmbedding(text: string) {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  for (const word of words) {
    let hash = 2166136261;
    for (let index = 0; index < word.length; index += 1) {
      hash ^= word.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const position = Math.abs(hash) % DIMENSIONS;
    vector[position] += hash % 2 === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  return norm ? vector.map((item) => item / norm) : vector;
}

/**
 * Truncating a Matryoshka vector breaks its unit length, and cosine distance
 * assumes unit length. Re-normalise or every similarity score is quietly wrong.
 */
function fitDimensions(vector: number[]) {
  if (vector.length === DIMENSIONS) return vector;
  const cut = vector.slice(0, DIMENSIONS);
  const norm = Math.sqrt(cut.reduce((sum, item) => sum + item * item, 0));
  return norm ? cut.map((item) => item / norm) : cut;
}

/** Texts per HTTP request. Providers reject very large batches. */
const BATCH = Number(process.env.EMBEDDING_BATCH?.trim()) || 64;

/** Backoff unit. Configurable so tests do not have to wait out real seconds. */
const RETRY_BASE_MS = Number(process.env.EMBEDDING_RETRY_BASE_MS ?? 1_000);

async function withRetry<T>(run: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      // Rate limits are the expected failure at indexing volume, and the right
      // response is to wait rather than to give up on the batch.
      const wait = RETRY_BASE_MS * 2 ** attempt;
      if (wait > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, wait + Math.random() * (RETRY_BASE_MS / 2)),
        );
      }
    }
  }
  throw new Error(`${label} failed after 4 attempts: ${String(lastError)}`);
}

/**
 * Cloudflare Workers AI. Serves the same Qwen3-Embedding-0.6B we run locally,
 * so switching between them does not change the vectors' meaning, and it takes
 * the instruction prefix as a first-class field instead of string concatenation.
 */
async function embedViaCloudflare(texts: string[], kind: EmbeddingKind) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!account || !token) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.");
  }
  const model = process.env.EMBEDDING_MODEL_ID?.trim() ||
    "@cf/qwen/qwen3-embedding-0.6b";
  const out: number[][] = [];
  for (let index = 0; index < texts.length; index += BATCH) {
    const slice = texts.slice(index, index + BATCH);
    const vectors = await withRetry(async () => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            text: slice,
            ...(kind === "query" ? { instruction: QUERY_INSTRUCTION } : {}),
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${await response.text()}`);
      }
      const payload = (await response.json()) as {
        result?: { data?: number[][] };
      };
      const data = payload.result?.data;
      if (!data?.length) throw new Error("No embeddings in response");
      return data;
    }, "Cloudflare embeddings");
    out.push(...vectors);
  }
  return out;
}

/**
 * Any OpenAI-compatible `/v1/embeddings` service: OpenRouter, Deepinfra,
 * SiliconFlow, Gemini's compatibility layer, OpenAI itself.
 */
async function embedViaOpenAI(texts: string[], kind: EmbeddingKind) {
  const baseUrl = process.env.EMBEDDING_BASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.EMBEDDING_API_KEY?.trim();
  if (!baseUrl || !key) {
    throw new Error("EMBEDDING_BASE_URL and EMBEDDING_API_KEY are required.");
  }
  const model = process.env.EMBEDDING_MODEL_ID?.trim() || MODEL;
  const out: number[][] = [];
  for (let index = 0; index < texts.length; index += BATCH) {
    const slice = texts
      .slice(index, index + BATCH)
      .map((text) => decorate(text, kind));
    const vectors = await withRetry(async () => {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: slice,
          // Honoured by providers that support Matryoshka truncation and
          // ignored by the rest, which is why fitDimensions still runs.
          dimensions: DIMENSIONS,
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${await response.text()}`);
      }
      const payload = (await response.json()) as {
        data?: Array<{ embedding: number[]; index?: number }>;
      };
      const data = payload.data;
      if (!data?.length) throw new Error("No embeddings in response");
      // The spec allows results out of order; only `index` is authoritative.
      return [...data]
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((item) => item.embedding);
    }, "OpenAI-compatible embeddings");
    out.push(...vectors);
  }
  return out;
}

export async function embedTexts(
  texts: string[],
  kind: EmbeddingKind = "document",
): Promise<number[][]> {
  if (!texts.length) return [];
  const provider = process.env.EMBEDDING_PROVIDER?.trim() || "local";
  if (provider === "hash") return texts.map(stableFallbackEmbedding);

  if (provider === "cloudflare" || provider === "openai") {
    // No silent fallback here. A hash vector is not a worse embedding, it is a
    // meaningless one, and writing those into the index would look like an
    // accuracy collapse rather than an outage. Let the caller fail and retry.
    const raw =
      provider === "cloudflare"
        ? await embedViaCloudflare(texts, kind)
        : await embedViaOpenAI(texts, kind);
    return raw.map(fitDimensions);
  }

  try {
    const extractor = await loadExtractor();
    const result = await extractor(
      texts.map((text) => decorate(text, kind)),
      { pooling: POOLING, normalize: true },
    );
    return result.tolist().map(fitDimensions);
  } catch (error) {
    logger.warn(
      { error, model: MODEL },
      "Embedding model unavailable; using deterministic local fallback",
    );
    return texts.map(stableFallbackEmbedding);
  }
}

export async function embedText(
  text: string,
  kind: EmbeddingKind = "document",
) {
  return (await embedTexts([text], kind))[0];
}

export const embeddingDimensions = DIMENSIONS;
