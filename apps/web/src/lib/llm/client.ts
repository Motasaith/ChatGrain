import { logger } from "@/lib/observability/logger";
import {
  DEFAULT_LLM_MODEL,
  isRetryableStatus,
  llmProviders,
  type LlmProvider,
} from "./providers";

type GenerateAnswerInput = {
  model?: string | null;
  systemPrompt: string;
  context: string;
  question: string;
  temperature: number;
  images?: Array<{
    mimeType: string;
    base64: string;
  }>;
  /** Ordered endpoints to try; defaults to the installation's chain. */
  providers?: LlmProvider[];
};

type DescribeImagesInput = {
  model?: string | null;
  images: Array<{
    mimeType: string;
    base64: string;
  }>;
};

/**
 * Written-chat rules: Markdown and bracketed citations are wanted on screen.
 */
const WRITTEN_ANSWER_RULES = `Use only facts stated in the supplied evidence. An article that mentions a product or service is not evidence that the business sells or offers it. Do not expose database field names, source metadata, or raw extraction labels. Answer the current question directly in two to five sentences unless the customer explicitly asks for steps or a detailed list. Use simple Markdown only when it improves readability. When the customer asks for an article, link, or related content, use the supplied evidence URLs as clickable Markdown links. Cite every factual claim with the matching evidence number such as [1]. If the evidence does not support the answer, return exactly NOT_ENOUGH_EVIDENCE. Never invent a policy, number, link, action result, contact detail, or customer detail.`;

/**
 * Spoken-call rules. Everything here exists because a speech engine reads it
 * aloud: Markdown becomes "asterisk asterisk", `[1]` becomes "bracket one",
 * and long paragraphs leave the caller with no chance to interrupt.
 */
const SPOKEN_ANSWER_RULES = `You are speaking out loud on a live phone-style call. Use only facts stated in the supplied evidence.

Speak the way a helpful person speaks:
- Reply in one to three short sentences. Never monologue.
- Plain spoken words only. No Markdown, no asterisks, no headings, no bullet lists, no numbered lists, no emoji.
- Never say citation markers, evidence numbers, or bracketed references out loud.
- Never read a URL aloud. Say "I have put the link on your screen" instead.
- Expand things people say in words: say "twenty four seven", not "24/7".
- If you need something from the caller, ask one short question and stop.
- Contractions are good. Sound natural, not formal.

Do not expose database field names, source metadata, or raw extraction labels. If the evidence does not support the answer, return exactly NOT_ENOUGH_EVIDENCE. Never invent a policy, number, link, action result, contact detail, or customer detail.`;

function answerSystemPrompt(systemPrompt: string, voice: boolean) {
  return `${systemPrompt}

${voice ? SPOKEN_ANSWER_RULES : WRITTEN_ANSWER_RULES}`;
}

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
    DEFAULT_LLM_MODEL
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

/**
 * Turns an image into a short retrieval query before the knowledge-base
 * search runs. This is deliberately separate from answer generation: searching
 * for "the post in this picture" cannot work until the visible title and other
 * identifiers have been read from the picture.
 */
export async function describeImagesForSearch({
  model,
  images,
}: DescribeImagesInput) {
  if (!images.length) return null;
  const baseUrl = llmBaseUrl();
  const apiKey = llmApiKey();
  if (new URL(baseUrl).hostname === "ollama.com" && !apiKey) {
    logger.warn(
      "Ollama Cloud is configured for visual search, but LLM_API_KEY is missing",
    );
    return null;
  }
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model:
          model?.trim() ||
          process.env.VISION_LLM_MODEL?.trim() ||
          defaultLlmModel(),
        messages: [
          {
            role: "system",
            content: `Create a website-search query from customer images.
Read the exact visible article, product, project, or page title when one is
present. Add at most five distinctive visible names or technical identifiers.
Do not answer the customer, explain the image, guess missing words, or add
labels such as "title" or "keywords". Return one plain-text line only.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract the most precise search query visible in the attached image.",
              },
              ...images.map((image) => ({
                type: "image_url",
                image_url: {
                  url: `data:${image.mimeType};base64,${image.base64}`,
                },
              })),
            ],
          },
        ],
        temperature: 0,
        max_tokens: 120,
        stream: false,
      }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Ollama-compatible visual search extraction failed",
      );
      return null;
    }
    const payload = (await response.json()) as ChatCompletionResponse;
    const query = payload.choices?.[0]?.message?.content
      ?.replace(/\s+/g, " ")
      .replace(/^["']|["']$/g, "")
      .trim()
      .slice(0, 500);
    return query || null;
  } catch (error) {
    logger.warn({ error }, "Visual search extraction failed");
    return null;
  }
}

export async function generateGroundedAnswer({
  model,
  systemPrompt,
  context,
  question,
  temperature,
  images = [],
  providers,
}: GenerateAnswerInput) {
  const chain = providers?.length ? providers : llmProviders();
  const requestBody = (chosenModel: string) =>
    JSON.stringify({
      model: chosenModel,
      messages: [
        {
          role: "system",
          content: answerSystemPrompt(systemPrompt, false),
        },
        {
          role: "user",
          content: images.length
            ? [
                {
                  type: "text",
                  text: `Evidence:
${context}

Customer question: ${question}

Use the attached image to understand what the customer is showing. Answer the
customer's question about it directly. Do not dump OCR text, enumerate every
visible label, or describe unrelated visual details. Summarize only the parts
that matter to the question in two to five sentences. Keep website-specific
claims grounded in the supplied evidence.`,
                },
                ...images.map((image) => ({
                  type: "image_url",
                  image_url: {
                    url: `data:${image.mimeType};base64,${image.base64}`,
                  },
                })),
              ]
            : `Evidence:
${context}

Customer question: ${question}`,
        },
      ],
      temperature,
      max_tokens: 320,
      stream: false,
    });

  // Walk the chain: a rate-limited free tier or a provider outage should cost
  // a few hundred milliseconds, not the answer.
  for (const [index, provider] of chain.entries()) {
    const chosenModel = model?.trim() || provider.model;
    const last = index === chain.length - 1;
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(provider.apiKey
            ? { authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: requestBody(chosenModel),
        signal: AbortSignal.timeout(45_000),
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status, provider: provider.label, model: chosenModel },
          "Generation request failed",
        );
        if (last || !isRetryableStatus(response.status)) return null;
        continue;
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const answer = payload.choices?.[0]?.message?.content?.trim();
      if (!answer) {
        // An empty completion is a provider problem, not a refusal; the
        // sentinel is how a model declines, and that must not be retried.
        if (last) return null;
        continue;
      }
      if (answer.includes("NOT_ENOUGH_EVIDENCE")) return null;
      return answer;
    } catch (error) {
      // Timeouts and DNS failures never reach the status check above.
      logger.warn(
        { error, provider: provider.label },
        "Generation request threw",
      );
      if (last) return null;
    }
  }
  return null;
}

export type GroundedAnswerChunk =
  | { type: "delta"; text: string }
  | { type: "done"; text: string }
  /** Model returned NOT_ENOUGH_EVIDENCE; caller should fall back. */
  | { type: "insufficient" };

/**
 * Number of leading characters held back before the first delta is emitted.
 * `NOT_ENOUGH_EVIDENCE` must never be spoken aloud or shown, and it can only
 * be recognized once enough of the first tokens have arrived.
 */
const SENTINEL_HOLD_CHARS = 24;

/**
 * Streaming twin of `generateGroundedAnswer`, used by the realtime voice
 * gateway so speech synthesis can start on the first sentence instead of
 * waiting for the whole completion.
 */
export async function* streamGroundedAnswer({
  model,
  systemPrompt,
  context,
  question,
  temperature,
  voice = false,
  signal,
}: Omit<GenerateAnswerInput, "images"> & {
  voice?: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<GroundedAnswerChunk> {
  const baseUrl = llmBaseUrl();
  const apiKey = llmApiKey();
  const cloudRequest = new URL(baseUrl).hostname === "ollama.com";

  if (cloudRequest && !apiKey) {
    logger.warn(
      "Ollama Cloud is the configured answer engine, but LLM_API_KEY is missing",
    );
    yield { type: "insufficient" };
    return;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model?.trim() || defaultLlmModel(),
        messages: [
          { role: "system", content: answerSystemPrompt(systemPrompt, voice) },
          {
            role: "user",
            content: `Evidence:
${context}

Customer question: ${question}`,
          },
        ],
        temperature,
        max_tokens: voice ? 200 : 320,
        stream: true,
      }),
      signal,
    });
  } catch (error) {
    if (!signal?.aborted) {
      logger.warn({ error }, "Streaming generation request failed");
    }
    yield { type: "insufficient" };
    return;
  }

  if (!response.ok || !response.body) {
    logger.warn(
      { status: response.status, model: model || defaultLlmModel() },
      "Streaming generation request failed",
    );
    yield { type: "insufficient" };
    return;
  }

  let full = "";
  let emitted = 0;

  for await (const delta of readCompletionDeltas(response.body, signal)) {
    full += delta;
    if (full.includes("NOT_ENOUGH_EVIDENCE")) {
      yield { type: "insufficient" };
      return;
    }
    // Hold the opening characters back until the sentinel is ruled out.
    if (full.length < SENTINEL_HOLD_CHARS) continue;
    const pending = full.slice(emitted);
    if (pending) {
      emitted = full.length;
      yield { type: "delta", text: pending };
    }
  }

  const answer = full.trim();
  if (!answer) {
    yield { type: "insufficient" };
    return;
  }
  if (emitted < full.length) {
    yield { type: "delta", text: full.slice(emitted) };
  }
  yield { type: "done", text: answer };
}

/** Parses an OpenAI-compatible `text/event-stream` completion body. */
async function* readCompletionDeltas(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");

        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const text = parsed.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {
          // A partial JSON line means the chunk boundary split it; the next
          // read appends the remainder, so skipping here is safe.
        }
      }
    }
  } catch (error) {
    if (!signal?.aborted) {
      logger.warn({ error }, "Streaming generation body failed");
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
