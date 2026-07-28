import { logger } from "@/lib/observability/logger";

type GenerateAnswerInput = {
  model?: string | null;
  systemPrompt: string;
  context: string;
  question: string;
  temperature: number;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function defaultLlmModel() {
  return (
    process.env.LLM_MODEL?.trim() ||
    process.env.VISION_LLM_MODEL?.trim() ||
    process.env.OLLAMA_MODEL?.trim() ||
    "gemma4:31b"
  );
}

export function llmBaseUrl() {
  if (process.env.LLM_BASE_URL?.trim()) {
    return normalizeBaseUrl(process.env.LLM_BASE_URL);
  }
  if (process.env.OLLAMA_URL?.trim()) {
    return `${normalizeBaseUrl(process.env.OLLAMA_URL)}/v1`;
  }
  return "https://ollama.com/v1";
}

export async function generateGroundedAnswer({
  model,
  systemPrompt,
  context,
  question,
  temperature,
}: GenerateAnswerInput) {
  const baseUrl = llmBaseUrl();
  const apiKey =
    process.env.LLM_API_KEY?.trim() ||
    process.env.OLLAMA_API_KEY?.trim() ||
    "";
  const cloudRequest = new URL(baseUrl).hostname === "ollama.com";

  if (cloudRequest && !apiKey) {
    logger.warn(
      "Ollama Cloud is the configured answer engine, but LLM_API_KEY is missing",
    );
    return null;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: model?.trim() || defaultLlmModel(),
      messages: [
        {
          role: "system",
          content: `${systemPrompt}

Use only the supplied evidence. If the evidence does not support an answer, return exactly NOT_ENOUGH_EVIDENCE. Never invent a policy, number, link, action result, or customer detail. Cite supporting evidence with [1], [2], and so on. Keep the answer concise and direct.`,
        },
        {
          role: "user",
          content: `Evidence:
${context}

Customer question: ${question}`,
        },
      ],
      temperature,
      max_tokens: 320,
      stream: false,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    logger.warn(
      { status: response.status, model: model || defaultLlmModel() },
      "Ollama-compatible generation request failed",
    );
    return null;
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const answer = payload.choices?.[0]?.message?.content?.trim();
  if (!answer || answer.includes("NOT_ENOUGH_EVIDENCE")) return null;
  return answer;
}
