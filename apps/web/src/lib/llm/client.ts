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

export type ConversationIntent = "human_handoff" | "knowledge";

type IntentHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function llmApiKey() {
  return (
    process.env.LLM_API_KEY?.trim() ||
    process.env.OLLAMA_API_KEY?.trim() ||
    ""
  );
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

export function parseConversationIntent(
  value: string | null | undefined,
): ConversationIntent {
  const label = value?.trim().toUpperCase().replace(/[^A-Z_]/g, "");
  return label === "HUMAN_HANDOFF" ? "human_handoff" : "knowledge";
}

export async function classifyConversationIntent({
  message,
  history = [],
  model,
}: {
  message: string;
  history?: IntentHistoryMessage[];
  model?: string | null;
}): Promise<ConversationIntent> {
  const baseUrl = llmBaseUrl();
  const apiKey = llmApiKey();
  const cloudRequest = new URL(baseUrl).hostname === "ollama.com";

  if (cloudRequest && !apiKey) {
    logger.warn(
      "Ollama Cloud is configured for intent routing, but LLM_API_KEY is missing",
    );
    return "knowledge";
  }

  const recentConversation = history
    .slice(-6)
    .map(
      (entry) =>
        `${entry.role === "user" ? "Customer" : "Assistant"}: ${entry.content.slice(0, 500)}`,
    )
    .join("\n");

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model:
          process.env.INTENT_LLM_MODEL?.trim() ||
          model?.trim() ||
          defaultLlmModel(),
        messages: [
          {
            role: "system",
            content: `You route customer messages. Understand every language, mixed languages, transliteration, Roman Urdu, spelling mistakes, and conversational follow-ups.

Return HUMAN_HANDOFF when the customer wants to talk, chat, call, email, message, contact, get a reply from, or be contacted by a real person, customer support, the website team, an administrator, an owner, staff, or an agent. Also return HUMAN_HANDOFF when they ask for direct contact details in order to reach those people.

Return KNOWLEDGE for normal factual, technical, product, article, policy, or troubleshooting questions. Merely mentioning words such as "support", "agent", "contact", or "team" is not a handoff unless the customer is asking to communicate with a person. Use recent conversation to resolve phrases such as "connect me to them".

Examples:
"can i contact the support team" -> HUMAN_HANDOFF
"mujhe admin se baat karni hai" -> HUMAN_HANDOFF
"کیا میں کسی انسان سے بات کر سکتا ہوں؟" -> HUMAN_HANDOFF
"أريد التحدث مع شخص من الدعم" -> HUMAN_HANDOFF
"Quiero hablar con una persona de soporte" -> HUMAN_HANDOFF
"Does this library support Raspberry Pi 5?" -> KNOWLEDGE
"How does customer support software work?" -> KNOWLEDGE

Return exactly one label and nothing else:
HUMAN_HANDOFF
KNOWLEDGE`,
          },
          {
            role: "user",
            content: `${recentConversation ? `Recent conversation:\n${recentConversation}\n\n` : ""}Current customer message:\n${message.slice(0, 1_500)}`,
          },
        ],
        temperature: 0,
        max_tokens: 12,
        stream: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Ollama-compatible intent routing request failed",
      );
      return "knowledge";
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    return parseConversationIntent(
      payload.choices?.[0]?.message?.content,
    );
  } catch (error) {
    logger.warn({ error }, "Conversation intent routing failed");
    return "knowledge";
  }
}

export async function generateGroundedAnswer({
  model,
  systemPrompt,
  context,
  question,
  temperature,
}: GenerateAnswerInput) {
  const baseUrl = llmBaseUrl();
  const apiKey = llmApiKey();
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
