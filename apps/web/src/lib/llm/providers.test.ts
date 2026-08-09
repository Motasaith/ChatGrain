import { describe, expect, it } from "vitest";
import {
  DEFAULT_LLM_MODEL,
  isRetryableStatus,
  llmProviders,
  providersForAgent,
} from "./providers";

const env = (values: Record<string, string>) =>
  values as unknown as NodeJS.ProcessEnv;

describe("llmProviders", () => {
  it("always yields a primary, even with nothing configured", () => {
    const providers = llmProviders(env({}));
    expect(providers).toHaveLength(1);
    expect(providers[0].model).toBe(DEFAULT_LLM_MODEL);
    expect(providers[0].baseUrl).toBe("https://ollama.com/v1");
  });

  it("reads numbered fallbacks in order", () => {
    const providers = llmProviders(
      env({
        LLM_BASE_URL: "https://ollama.com/v1",
        LLM_MODEL: "gemma4:31b",
        LLM_BASE_URL_02: "https://api.groq.com/openai/v1",
        LLM_MODEL_02: "llama-3.3-70b-versatile",
        LLM_API_KEY_02: "gsk_test",
      }),
    );
    expect(providers).toHaveLength(2);
    expect(providers[1].baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(providers[1].model).toBe("llama-3.3-70b-versatile");
  });

  it("stops at a gap rather than skipping past it", () => {
    // _04 without _03 is a configuration mistake. Silently using _04 would
    // hide it until the day the primary went down.
    const providers = llmProviders(
      env({
        LLM_BASE_URL_04: "https://example.com/v1",
        LLM_MODEL_04: "m",
      }),
    );
    expect(providers).toHaveLength(1);
  });

  it("ignores a fallback missing its model or URL", () => {
    // Inheriting the primary's URL would retry the endpoint that just failed.
    expect(
      llmProviders(env({ LLM_API_KEY_02: "key-only" })),
    ).toHaveLength(1);
    expect(
      llmProviders(env({ LLM_BASE_URL_02: "https://x/v1" })),
    ).toHaveLength(1);
  });

  it("allows a fallback with no key, for a self-hosted endpoint", () => {
    const providers = llmProviders(
      env({
        LLM_BASE_URL_02: "http://127.0.0.1:8000/v1",
        LLM_MODEL_02: "local",
      }),
    );
    expect(providers).toHaveLength(2);
    expect(providers[1].apiKey).toBe("");
  });

  it("keeps an old Ollama-only install working", () => {
    const providers = llmProviders(
      env({ OLLAMA_URL: "http://localhost:11434", OLLAMA_MODEL: "gemma4:31b" }),
    );
    expect(providers[0].baseUrl).toBe("http://localhost:11434/v1");
    expect(providers[0].model).toBe("gemma4:31b");
  });

  it("trims a trailing slash so paths do not double up", () => {
    const providers = llmProviders(
      env({ LLM_BASE_URL: "https://api.groq.com/openai/v1/", LLM_MODEL: "m" }),
    );
    expect(providers[0].baseUrl).toBe("https://api.groq.com/openai/v1");
  });

  it("never exposes a key in the label", () => {
    const providers = llmProviders(
      env({
        LLM_BASE_URL_02: "https://x/v1",
        LLM_MODEL_02: "m",
        LLM_API_KEY_02: "gsk_secret",
      }),
    );
    expect(providers[1].label).not.toContain("gsk_secret");
  });
});

describe("isRetryableStatus", () => {
  it("moves on for rate limits and provider faults", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it("moves on for auth failures, which another key may not have", () => {
    expect(isRetryableStatus(401)).toBe(true);
  });

  it("does not move on for a malformed request", () => {
    // The next provider would reject it identically; only the log would grow.
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe("providersForAgent", () => {
  const installation = env({
    LLM_BASE_URL: "https://ollama.com/v1",
    LLM_MODEL: "gemma4:31b",
  });

  it("tries the customer's own key first", () => {
    const chain = providersForAgent(
      {
        llmBaseUrl: "https://api.groq.com/openai/v1",
        llmApiKey: "gsk_customer",
        modelName: "llama-3.3-70b-versatile",
      },
      installation,
    );
    expect(chain[0].label).toBe("agent");
    expect(chain[0].apiKey).toBe("gsk_customer");
  });

  it("still falls back to the installation when their quota runs out", () => {
    // BYOK must not mean "no answer once the customer's credits are gone".
    const chain = providersForAgent(
      {
        llmBaseUrl: "https://api.groq.com/openai/v1",
        llmApiKey: "gsk_customer",
        modelName: "llama-3.3-70b-versatile",
      },
      installation,
    );
    expect(chain).toHaveLength(2);
    expect(chain[1].label).toBe("primary");
  });

  it("ignores a half-configured agent rather than sending an empty model", () => {
    expect(
      providersForAgent({ llmBaseUrl: "https://x/v1", modelName: null }, installation),
    ).toHaveLength(1);
    expect(
      providersForAgent({ llmBaseUrl: null, modelName: "some-model" }, installation),
    ).toHaveLength(1);
  });
});
