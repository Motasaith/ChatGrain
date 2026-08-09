/**
 * The ordered list of LLM endpoints to try.
 *
 * A single provider is a single point of failure: free tiers rate-limit,
 * hosted endpoints have outages, and a support widget that answers nothing
 * during either is worse than a slower answer from a second choice. Numbered
 * suffixes (_02, _03, ...) declare fallbacks in order.
 */

export type LlmProvider = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** For logs: which entry answered, without exposing the key. */
  label: string;
};

/** Tool-capable, fast, and available on a free tier - see the README note. */
export const DEFAULT_LLM_MODEL = "llama-3.3-70b-versatile";

const DEFAULT_BASE_URL = "https://ollama.com/v1";

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Reads one numbered slot. Suffix "" is the primary.
 *
 * A slot needs a model and a base URL to be usable; the key is optional
 * because a self-hosted endpoint may not require one.
 */
function readSlot(
  env: NodeJS.ProcessEnv,
  suffix: string,
): LlmProvider | null {
  const baseUrl = env[`LLM_BASE_URL${suffix}`]?.trim();
  const model = env[`LLM_MODEL${suffix}`]?.trim();
  const apiKey = env[`LLM_API_KEY${suffix}`]?.trim() ?? "";

  if (!suffix) {
    // The primary keeps the historical Ollama fallbacks so an existing install
    // that never set LLM_* keeps working untouched.
    const legacyBase = env.OLLAMA_URL?.trim();
    const resolvedBase = baseUrl
      ? normalizeBaseUrl(baseUrl)
      : legacyBase
        ? `${normalizeBaseUrl(legacyBase)}/v1`
        : DEFAULT_BASE_URL;
    const resolvedKey =
      apiKey || env.OLLAMA_API_KEY?.trim() || "";
    const resolvedModel =
      model ||
      env.VISION_LLM_MODEL?.trim() ||
      env.OLLAMA_MODEL?.trim() ||
      DEFAULT_LLM_MODEL;
    return {
      baseUrl: resolvedBase,
      apiKey: resolvedKey,
      model: resolvedModel,
      label: "primary",
    };
  }

  // A numbered slot is only real if it was deliberately configured. Inheriting
  // the primary's URL would silently retry the endpoint that just failed.
  if (!baseUrl || !model) return null;
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey,
    model,
    label: `fallback${suffix}`,
  };
}

export function llmProviders(
  env: NodeJS.ProcessEnv = process.env,
): LlmProvider[] {
  const providers = [readSlot(env, "")!];
  // Stops at the first missing number rather than scanning forever, so a gap
  // in the sequence is visible instead of silently skipping _03.
  for (let index = 2; index <= 20; index += 1) {
    const slot = readSlot(env, `_${String(index).padStart(2, "0")}`);
    if (!slot) break;
    providers.push(slot);
  }
  return providers;
}

/** True when trying the next provider could plausibly succeed. */
export function isRetryableStatus(status: number) {
  // 429 is a rate limit and 5xx is the provider's problem; both are exactly
  // what a fallback exists for. A 400 or 401 would fail identically on retry
  // of the same request, but may still succeed elsewhere with another key.
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

/**
 * The chain to use for one agent.
 *
 * A customer's own key goes first and the installation's providers follow, so
 * BYOK gets used when it works and the visitor still gets an answer when their
 * quota runs out. An agent that configured a key but whose model is missing
 * falls back rather than sending an empty model name.
 */
export function providersForAgent(
  agent: {
    llmBaseUrl?: string | null;
    llmApiKey?: string | null;
    modelName?: string | null;
  },
  env: NodeJS.ProcessEnv = process.env,
): LlmProvider[] {
  const chain = llmProviders(env);
  const baseUrl = agent.llmBaseUrl?.trim();
  const model = agent.modelName?.trim();
  if (!baseUrl || !model) return chain;
  return [
    {
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKey: agent.llmApiKey?.trim() ?? "",
      model,
      label: "agent",
    },
    ...chain,
  ];
}
