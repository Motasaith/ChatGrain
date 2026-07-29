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

Use only facts stated in the supplied evidence. An article that mentions a product or service is not evidence that the business sells or offers it. Do not expose database field names, source metadata, or raw extraction labels. Answer the current question directly in two to five sentences unless the customer explicitly asks for steps or a detailed list. Use simple Markdown only when it improves readability. Cite every factual claim with the matching evidence number such as [1]. If the evidence does not support the answer, return exactly NOT_ENOUGH_EVIDENCE. Never invent a policy, number, link, action result, contact detail, or customer detail.`,
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
