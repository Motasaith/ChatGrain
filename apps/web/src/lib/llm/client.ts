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
const WRITTEN_ANSWER_RULES = `Follow these rules for every answer.

Evidence:
- Use only facts stated in the supplied evidence. Never invent a policy, price, plan, number, link, action result, contact detail, or customer detail.
- An article that mentions a product or service is not evidence that the business sells or offers it.
- Answer the question that was actually asked. If the evidence is about a different topic, it does not support an answer, however close it looks.
- If the evidence does not support an answer, return exactly NOT_ENOUGH_EVIDENCE and nothing else.

Writing:
- Answer the current question directly in two to five sentences unless the customer explicitly asks for steps or a detailed list.
- Compose the answer in your own words. Do not copy sentences or fragments from the evidence, and never stitch fragments together into a reply.
- The evidence is extracted from web pages, so it contains leftovers that are not prose: step numbers, list markers, button and menu labels, headings sitting directly against body text. Never reproduce these. Read through them to the meaning and state it as a sentence.
- Do not expose database field names, source metadata, or raw extraction labels.
- Use simple Markdown only when it improves readability. When the customer asks for an article, link, or related content, use the supplied evidence URLs as clickable Markdown links.
- Cite every factual claim with the matching evidence number such as [1].`;

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

export function defaultLlmModel() {
  return (
    process.env.LLM_MODEL?.trim() ||
    process.env.VISION_LLM_MODEL?.trim() ||
    process.env.OLLAMA_MODEL?.trim() ||
    DEFAULT_LLM_MODEL
  );
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
  providers,
}: {
  message: string;
  history?: IntentHistoryMessage[];
  /** Ordered endpoints to try; defaults to the installation's chain. */
  providers?: LlmProvider[];
}): Promise<ConversationIntent> {
  // The same chain that answers questions. Reading LLM_API_KEY directly, as
  // this used to, meant an install configured with named providers had no key
  // here at all: routing bailed at the guard and every message was classified
  // KNOWLEDGE, so a misspelling like "damin" could never reach a human.
  const chain = providers?.length ? providers : llmProviders();

  const recentConversation = history
    .slice(-6)
    .map(
      (entry) =>
        `${entry.role === "user" ? "Customer" : "Assistant"}: ${entry.content.slice(0, 500)}`,
    )
    .join("\n");

  const requestBody = (chosenModel: string) =>
    JSON.stringify({
      model: chosenModel,
      messages: [
        {
          role: "system",
          content: `You route customer messages. Understand every language, mixed languages, transliteration, Roman Urdu, spelling mistakes, and conversational follow-ups.

Read through typos and phonetic spellings to the word the customer meant: "damin", "adminn" and "admn" are all "admin"; "supprt" is "support"; "humen" is "human".

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
      // The label is one token, but a reasoning model spends its budget
      // thinking before it emits any content at all. At max_tokens: 12 such a
      // model returns finish_reason "length" with content "", which parses as
      // KNOWLEDGE - a silent misroute, not an error. The headroom costs
      // nothing on a model that answers directly.
      max_tokens: 512,
      stream: false,
    });

  for (const [index, provider] of chain.entries()) {
    const last = index === chain.length - 1;
    // The provider's own model, never the agent's: routing does not need a
    // specific model, and sending one provider's model name to another is a
    // 400 that would fall through to KNOWLEDGE.
    const chosenModel = process.env.INTENT_LLM_MODEL?.trim() || provider.model;
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
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status, provider: provider.label },
          "Intent routing request failed",
        );
        if (last || !isRetryableStatus(response.status)) return "knowledge";
        continue;
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const label = payload.choices?.[0]?.message?.content?.trim();
      if (!label) {
        // No content means the provider never produced a verdict. Parsing that
        // yields KNOWLEDGE, which is indistinguishable from a real decision, so
        // ask the next provider instead of inventing one.
        logger.warn(
          { provider: provider.label },
          "Intent routing returned no label",
        );
        if (last) return "knowledge";
        continue;
      }
      return parseConversationIntent(label);
    } catch (error) {
      logger.warn(
        { error, provider: provider.label },
        "Intent routing request threw",
      );
      if (last) return "knowledge";
    }
  }
  return "knowledge";
}

/**
 * Repairs a question that retrieved nothing worth answering from.
 *
 * Deliberately not run on every message. A first pass that already found good
 * evidence needs no repair, and paying a round-trip on every question to fix
 * the minority that are misspelled makes the common case slower for nothing.
 */
export async function rewriteSearchQuery({
  question,
  providers,
}: {
  question: string;
  providers?: LlmProvider[];
}): Promise<string | null> {
  const chain = providers?.length ? providers : llmProviders();
  const requestBody = (chosenModel: string) =>
    JSON.stringify({
      model: chosenModel,
      messages: [
        {
          role: "system",
          content: `Rewrite a website visitor's message into a search query for that website's own pages.

- Correct spelling, typos, and phonetic spellings: "viwer" is "viewer", "dose" is "does", "opne" is "open".
- Repair grammar and expand ordinary abbreviations.
- Never expand or translate a file extension, format, product code, or model number. "msg", "eml" and "heic" are names, not abbreviations, and rewriting one to a normal word destroys the only term that could match a page.
- Drop conversational filler such as "can you tell me", "please", "I want to know".
- Keep the visitor's own nouns and meaning. Never add a topic, product, or brand they did not mention.
- If the message is already a clean query, return it unchanged.

Return the query alone on one line. No quotes, no explanation, no label.`,
        },
        { role: "user", content: question.slice(0, 500) },
      ],
      temperature: 0,
      max_tokens: 400,
      stream: false,
    });

  for (const [index, provider] of chain.entries()) {
    const last = index === chain.length - 1;
    const chosenModel =
      process.env.INTENT_LLM_MODEL?.trim() || provider.model;
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
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        if (last || !isRetryableStatus(response.status)) return null;
        continue;
      }
      const payload = (await response.json()) as ChatCompletionResponse;
      const rewritten = payload.choices?.[0]?.message?.content
        ?.replace(/\s+/g, " ")
        .replace(/^["']|["']$/g, "")
        .trim()
        .slice(0, 300);
      if (rewritten) return rewritten;
      if (last) return null;
    } catch (error) {
      logger.warn(
        { error, provider: provider.label },
        "Query rewrite request threw",
      );
      if (last) return null;
    }
  }
  return null;
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
  // Chain, for the same reason as the other two callers: the old LLM_API_KEY
  // guard disabled visual search outright on a named-provider install.
  const chain = llmProviders();
  const requestBody = (chosenModel: string) =>
    JSON.stringify({
      model: chosenModel,
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
      max_tokens: 400,
      stream: false,
    });

  for (const [index, provider] of chain.entries()) {
    const last = index === chain.length - 1;
    const chosenModel =
      model?.trim() ||
      process.env.VISION_LLM_MODEL?.trim() ||
      provider.model;
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
        signal: AbortSignal.timeout(35_000),
      });
      if (!response.ok) {
        logger.warn(
          { status: response.status, provider: provider.label },
          "Visual search extraction failed",
        );
        // A text-only provider in the chain cannot read an image, so moving on
        // is the normal path here rather than the exception.
        if (last || !isRetryableStatus(response.status)) return null;
        continue;
      }
      const payload = (await response.json()) as ChatCompletionResponse;
      const query = payload.choices?.[0]?.message?.content
        ?.replace(/\s+/g, " ")
        .replace(/^["']|["']$/g, "")
        .trim()
        .slice(0, 500);
      if (query) return query;
      if (last) return null;
    } catch (error) {
      logger.warn(
        { error, provider: provider.label },
        "Visual search extraction threw",
      );
      if (last) return null;
    }
  }
  return null;
}

/**
 * The model to ask one provider for.
 *
 * A caller's model is honoured only where the provider can actually serve it:
 * its own endpoint, or a provider configured with that exact model. Applying it
 * to the whole chain sends one vendor's model name to another, which is a 404
 * and a wasted round trip.
 *
 * That is not theoretical. Every agent carries `gemma4:31b` as its schema
 * default, so every installation asked Groq for an Ollama model, got a 404, and
 * quietly fell through to its slowest provider - measured at 4.4s against
 * 0.94s for the Groq model that was configured and never used.
 */
function modelFor(provider: LlmProvider, requested?: string | null) {
  const wanted = requested?.trim();
  if (!wanted) return provider.model;
  return provider.label === "agent" || provider.model === wanted
    ? wanted
    : provider.model;
}

/**
 * Providers that can serve a model the request cannot do without.
 *
 * Only images need this. A text model sent image content answers badly or
 * rejects the request with a 400, which is not retryable, so the chain would
 * end on a provider that was never able to help.
 */
function providersServing(chain: LlmProvider[], required: string | undefined) {
  const wanted = required?.trim();
  if (!wanted) return chain;
  const usable = chain.filter(
    (provider) => provider.label === "agent" || provider.model === wanted,
  );
  return usable.length ? usable : chain;
}

export type GroundedAnswer =
  /** The model answered from the evidence. */
  | { status: "answered"; text: string }
  /** The model read the evidence and said it does not answer the question. */
  | { status: "declined" }
  /** No provider produced anything; nothing was judged. */
  | { status: "unavailable" };

export async function generateGroundedAnswer({
  model,
  systemPrompt,
  context,
  question,
  temperature,
  images = [],
  providers,
}: GenerateAnswerInput): Promise<GroundedAnswer> {
  // An image request cannot be served by a text-only provider, so the chain is
  // narrowed to those that carry the vision model rather than letting one
  // reject the request and end the walk.
  const chain = providersServing(
    providers?.length ? providers : llmProviders(),
    images.length ? (model ?? undefined) : undefined,
  );
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
      // Headroom for a reasoning model, which emits its thinking before any
      // content. This is a ceiling, not a target - answer length is set by the
      // prompt - but too low a ceiling returns an empty completion, which is
      // indistinguishable here from the model having nothing to say.
      max_tokens: 900,
      stream: false,
    });

  // Walk the chain: a rate-limited free tier or a provider outage should cost
  // a few hundred milliseconds, not the answer.
  for (const [index, provider] of chain.entries()) {
    const chosenModel = modelFor(provider, model);
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
        if (last || !isRetryableStatus(response.status)) {
          return { status: "unavailable" };
        }
        continue;
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const answer = payload.choices?.[0]?.message?.content?.trim();
      if (!answer) {
        // An empty completion is a provider problem, not a refusal; the
        // sentinel is how a model declines, and that must not be retried.
        if (last) return { status: "unavailable" };
        continue;
      }
      // "The evidence does not answer this" is a verdict, not a failure, and
      // the two need different handling: a verdict means say so, a failure
      // means fall back to whatever the retrieved text can support.
      if (answer.includes("NOT_ENOUGH_EVIDENCE")) return { status: "declined" };
      return { status: "answered", text: answer };
    } catch (error) {
      // Timeouts and DNS failures never reach the status check above.
      logger.warn(
        { error, provider: provider.label },
        "Generation request threw",
      );
      if (last) return { status: "unavailable" };
    }
  }
  return { status: "unavailable" };
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
  providers,
  voice = false,
  signal,
}: Omit<GenerateAnswerInput, "images"> & {
  voice?: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<GroundedAnswerChunk> {
  // Same chain as the non-streaming path. This used to read LLM_API_KEY
  // directly, so on an install configured with named providers every voice
  // answer stopped at the guard below and the caller only ever saw
  // `insufficient`.
  const chain = providers?.length ? providers : llmProviders();

  let response: Response | undefined;
  for (const [index, provider] of chain.entries()) {
    const last = index === chain.length - 1;
    try {
      const attempt = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(provider.apiKey
            ? { authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: modelFor(provider, model),
          messages: [
            {
              role: "system",
              content: answerSystemPrompt(systemPrompt, voice),
            },
            {
              role: "user",
              content: `Evidence:
${context}

Customer question: ${question}`,
            },
          ],
          temperature,
          // See the ceiling note in `generateGroundedAnswer`. Voice stays
          // tighter because a caller cannot skim a long spoken reply.
          max_tokens: voice ? 600 : 900,
          stream: true,
        }),
        signal,
      });
      if (attempt.ok && attempt.body) {
        response = attempt;
        break;
      }
      logger.warn(
        { status: attempt.status, provider: provider.label },
        "Streaming generation request failed",
      );
      if (last || !isRetryableStatus(attempt.status)) break;
    } catch (error) {
      if (signal?.aborted) return;
      logger.warn(
        { error, provider: provider.label },
        "Streaming generation request threw",
      );
      if (last) break;
    }
  }

  if (!response?.body) {
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
