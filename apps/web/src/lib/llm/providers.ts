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

/**
 * Tool-capable, fast, and available on a free tier - see the README note.
 *
 * Vendors retire models, and a retired name here 404s on every request. That
 * is survivable now only because `isRetryableStatus` treats 404 as a reason to
 * try the next provider rather than to give up on the chain.
 */
export const DEFAULT_LLM_MODEL = "openai/gpt-oss-120b";

const DEFAULT_BASE_URL = "https://ollama.com/v1";

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Named providers, each of which may hold several keys.
 *
 *   LLM_PROVIDERS=groq,ollama
 *   LLM_GROQ_BASE_URL=https://api.groq.com/openai/v1
 *   LLM_GROQ_MODEL=llama-3.3-70b-versatile
 *   LLM_GROQ_API_KEY=gsk_first
 *   LLM_GROQ_API_KEY_2=gsk_second
 *
 * Naming them beats numbering them: a log line saying "groq_2 rate limited"
 * is actionable, "fallback_03" is not. Several keys on one provider is the
 * common case - free tiers meter per key, so a second key is more quota on the
 * same endpoint rather than a different vendor.
 *
 * Model and base URL may be overridden per key with the same suffix, so any
 * entry can run a different model.
 */
function namedProviders(env: NodeJS.ProcessEnv): LlmProvider[] {
  const order = env.LLM_PROVIDERS?.trim();
  if (!order) return [];

  const providers: LlmProvider[] = [];
  for (const rawName of order.split(",")) {
    const name = rawName.trim();
    if (!name) continue;
    const prefix = `LLM_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    const baseUrl = env[`${prefix}_BASE_URL`]?.trim();
    const model = env[`${prefix}_MODEL`]?.trim();

    // Suffix "" is the first key; _2, _3, ... are additional quota.
    for (let index = 1; index <= 20; index += 1) {
      const suffix = index === 1 ? "" : `_${index}`;
      const apiKey = env[`${prefix}_API_KEY${suffix}`]?.trim();
      const entryBase = env[`${prefix}_BASE_URL${suffix}`]?.trim() ?? baseUrl;
      const entryModel = env[`${prefix}_MODEL${suffix}`]?.trim() ?? model;

      // A first entry may legitimately have no key, for a self-hosted
      // endpoint. Later entries exist only because a key was added.
      if (index > 1 && !apiKey) break;
      if (!entryBase || !entryModel) break;

      providers.push({
        baseUrl: normalizeBaseUrl(entryBase),
        apiKey: apiKey ?? "",
        model: entryModel,
        label: index === 1 ? name : `${name}_${index}`,
      });
    }
  }
  return providers;
}

/**
 * Reads one numbered slot of the older unnamed form.
 *
 * Kept so an install configured before named providers existed keeps working
 * without anyone editing a .env during a deploy.
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
  // Named providers win outright when declared: mixing both forms would make
  // the effective order impossible to read off the file.
  const named = namedProviders(env);
  if (named.length) return named;

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
  //
  // 404 is the one that matters most in practice: it is what a provider
  // returns for a model it does not serve, either because the chain is asking
  // for another provider's model or because the vendor retired it. Treating it
  // as terminal meant one stale model name in the first entry silently
  // disabled generation for the whole chain, and the caller read that as "the
  // model declined to answer" rather than "nothing was ever asked".
  return (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 429 ||
    status >= 500
  );
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
