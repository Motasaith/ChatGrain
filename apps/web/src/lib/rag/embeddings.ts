import { logger } from "@/lib/observability/logger";

const DIMENSIONS = 384;
const MODEL =
  process.env.EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2";

type Extractor = (
  input: string[],
  options: { pooling: "mean"; normalize: true },
) => Promise<{ tolist(): number[][] }>;

let extractorPromise: Promise<Extractor> | undefined;

async function loadExtractor() {
  if (!extractorPromise) {
    extractorPromise = import("@huggingface/transformers").then(
      async ({ env, pipeline }) => {
        env.cacheDir = process.env.MODEL_CACHE_DIR ?? ".cache/models";
        const extractor = await pipeline("feature-extraction", MODEL, {
          dtype: "q8",
        });
        logger.info({ model: MODEL }, "Local embedding model loaded");
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

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  if (process.env.EMBEDDING_PROVIDER === "hash") {
    return texts.map(stableFallbackEmbedding);
  }
  try {
    const extractor = await loadExtractor();
    const result = await extractor(texts, {
      pooling: "mean",
      normalize: true,
    });
    return result.tolist();
  } catch (error) {
    logger.warn(
      { error, model: MODEL },
      "Embedding model unavailable; using deterministic local fallback",
    );
    return texts.map(stableFallbackEmbedding);
  }
}

export async function embedText(text: string) {
  return (await embedTexts([text]))[0];
}
