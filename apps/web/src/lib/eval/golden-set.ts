import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chunks, documents } from "@/lib/db/schema";
import { isRetryableStatus, llmProviders } from "@/lib/llm/providers";
import { logger } from "@/lib/observability/logger";
import type { EvalCase } from "./metrics";

/**
 * Builds a golden set by sampling indexed chunks and asking an LLM what
 * question each one answers.
 *
 * The direction matters. Writing questions first and hunting for the chunk
 * that answers them produces a set biased toward whatever the author already
 * knew was on the site. Starting from the chunk gives coverage of the corpus
 * as it actually is, including the parts nobody thinks to ask about.
 *
 * The generator is not trusted on its own: it writes the questions, a human
 * accepts or rejects a sample, and only then are the numbers worth quoting.
 * See `reviewSample` below.
 */

/** Sampled across the corpus rather than from one page or one crawl order. */
export async function sampleChunks(agentId: string, count: number) {
  return db
    .select({
      chunkId: chunks.id,
      content: chunks.content,
      title: documents.title,
      url: documents.canonicalUrl,
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(
      and(
        eq(chunks.agentId, agentId),
        isNotNull(documents.canonicalUrl),
        // Chunks too short to contain a fact produce questions no retriever
        // could reasonably answer, which shows up as permanent false misses.
        sql`length(${chunks.content}) > 200`,
      ),
    )
    .orderBy(sql`random()`)
    .limit(count);
}

const QUESTION_PROMPT = `You are building a test set for a website search system.

Given one passage from a website, write ONE question that a real visitor to that
website might ask, which this passage answers.

Rules:
- The question must be answerable from the passage alone.
- Write it the way a visitor would type it, not the way the passage is worded.
  Reusing the passage's exact phrasing makes the test measure nothing.
- Do not mention "the passage", "the text", or "this page".
- If the passage is boilerplate (navigation, cookie notice, footer) and answers
  no real question, reply with exactly: SKIP

Reply with the question alone, no preamble.`;

/**
 * A plain completion against the provider chain.
 *
 * `generateGroundedAnswer` is not usable here: it wraps whatever system prompt
 * it is given in the agent's grounding and citation rules, which is right for
 * answering a visitor and wrong for asking the model to invent a question.
 * The intent classifier calls the endpoint directly for the same reason.
 */
async function complete(systemPrompt: string, userPrompt: string) {
  let lastError: unknown;
  for (const provider of llmProviders()) {
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(provider.apiKey
            ? { authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status} from ${provider.label}`);
        if (isRetryableStatus(response.status)) continue;
        throw lastError;
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return payload.choices?.[0]?.message?.content?.trim() ?? "";
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No LLM provider is configured.");
}

/**
 * Writes one question per passage.
 *
 * Split out from `generateCases` so it can run over text that is not indexed
 * yet - comparing two embedding models means asking the same questions of
 * both, which has to happen before either index exists.
 */
export async function generateQuestionsFor(
  passages: Array<{ content: string; title?: string; url?: string }>,
): Promise<Array<{ question: string; url: string }>> {
  const out: Array<{ question: string; url: string }> = [];
  for (const passage of passages) {
    let question: string;
    try {
      question = await complete(
        QUESTION_PROMPT,
        `Passage from "${passage.title ?? "the site"}":\n\n${passage.content.slice(0, 4_000)}`,
      );
    } catch (error) {
      // The message, not the Error: pino serialises a bare Error to `{}`, which
      // turns "no API key" and "model not found" into the same blank log line.
      logger.warn(
        { reason: error instanceof Error ? error.message : String(error) },
        "Question generation failed",
      );
      continue;
    }
    if (!question || /^SKIP$/i.test(question)) continue;
    out.push({ question, url: passage.url ?? "" });
  }
  return out;
}

export type GeneratedCase = EvalCase & {
  sourceChunkId: string;
  sourceUrl?: string;
  sourceTitle?: string;
  excerpt: string;
};

/**
 * Turns sampled chunks into cases. Chunks the model marks as boilerplate are
 * dropped rather than turned into unanswerable questions - a nav bar produces
 * a question nothing can answer, and that is measurement noise, not a signal.
 */
export async function generateCases(
  agentId: string,
  { count = 200 }: { count?: number } = {},
): Promise<GeneratedCase[]> {
  const sampled = await sampleChunks(agentId, count);
  const cases: GeneratedCase[] = [];
  for (const chunk of sampled) {
    let question: string;
    try {
      question = await complete(
        QUESTION_PROMPT,
        `Passage from "${chunk.title ?? "the site"}":\n\n${chunk.content.slice(0, 4_000)}`,
      );
    } catch (error) {
      logger.warn(
        {
          chunkId: chunk.chunkId,
          reason: error instanceof Error ? error.message : String(error),
        },
        "Question generation failed",
      );
      continue;
    }
    if (!question || /^SKIP$/i.test(question)) continue;
    cases.push({
      id: chunk.chunkId,
      question,
      expectedChunkIds: [chunk.chunkId],
      expectedUrls: chunk.url ? [chunk.url] : undefined,
      sourceChunkId: chunk.chunkId,
      sourceUrl: chunk.url ?? undefined,
      sourceTitle: chunk.title ?? undefined,
      excerpt: chunk.content.slice(0, 300),
    });
  }
  return cases;
}

/**
 * Picks the subset a human should check.
 *
 * The plan asks for 50, and the reason is calibration rather than coverage:
 * if the generator writes bad questions, every number downstream is wrong in a
 * way no amount of running it will reveal. Deterministic by index so the same
 * sample can be re-reviewed after a prompt change.
 */
export function reviewSample<T>(cases: T[], size = 50): T[] {
  if (cases.length <= size) return [...cases];
  const step = cases.length / size;
  return Array.from({ length: size }, (_, i) => cases[Math.floor(i * step)]);
}
