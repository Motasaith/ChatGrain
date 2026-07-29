import { eq, sql } from "drizzle-orm";
import type { Agent } from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { pinnedAnswers } from "@/lib/db/schema";
import {
  defaultLlmModel,
  generateGroundedAnswer,
} from "@/lib/llm/client";
import { logger } from "@/lib/observability/logger";
import {
  findLatestIndexedLink,
  hybridRetrieve,
  type RetrievalHit,
} from "@/lib/rag/retrieve";

function asksForLatestLink(question: string) {
  return (
    /\b(?:latest|newest|most\s+recent|recent)\b/i.test(question) &&
    /\b(?:url|link|post|article|page|news)\b/i.test(question)
  );
}

function terms(value: string) {
  return new Set(
    (value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
      (word) =>
        !new Set([
          "the",
          "and",
          "that",
          "this",
          "with",
          "from",
          "your",
          "what",
          "when",
          "where",
          "how",
        ]).has(word),
    ),
  );
}

async function findPinnedAnswer(agentId: string, question: string) {
  const entries = await db
    .select()
    .from(pinnedAnswers)
    .where(eq(pinnedAnswers.agentId, agentId));
  const query = terms(question);
  let best:
    | { id: string; title: string; answer: string; score: number }
    | undefined;
  for (const entry of entries) {
    for (const candidate of entry.questions) {
      const target = terms(candidate);
      const overlap = [...query].filter((word) => target.has(word)).length;
      const score = overlap / Math.max(1, Math.sqrt(query.size * target.size));
      if (!best || score > best.score) {
        best = {
          id: entry.id,
          title: entry.title,
          answer: entry.answer,
          score,
        };
      }
    }
  }
  if (!best || best.score < 0.72) return null;
  await db
    .update(pinnedAnswers)
    .set({ useCount: sql`${pinnedAnswers.useCount} + 1` })
    .where(eq(pinnedAnswers.id, best.id));
  return best;
}

function sentenceScore(question: string, sentence: string) {
  const query = terms(question);
  const content = terms(sentence);
  const overlap = [...query].filter((word) => content.has(word)).length;
  return overlap / Math.max(1, query.size);
}

function extractiveAnswer(question: string, hits: RetrievalHit[]) {
  const seen = new Set<string>();
  return hits
    .slice(0, 4)
    .flatMap((hit, hitIndex) =>
      (hit.content.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [
        hit.content,
      ]).map((sentence) => ({
        sentence: sentence.trim(),
        score:
          sentenceScore(question, sentence) +
          Math.max(0, hit.vectorScore) * 0.08 +
          Math.min(hit.keywordScore, 1) * 0.08 -
          hitIndex * 0.8,
      })),
    )
    .filter(
      (item) =>
        item.sentence.length > 45 &&
        item.sentence.length < 650 &&
        !/\b(?:isbn|retrieved|archived|doi|volume|bibliography|references)\b/i.test(
          item.sentence,
        ) &&
        !/^\s*["“][^"”]{3,80}["”]\s*[.,]?$/u.test(item.sentence),
    )
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      const normalized = item.sentence.toLowerCase().replace(/\W+/g, " ").trim();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 3)
    .map((item) => item.sentence)
    .join(" ")
    .slice(0, 1_200);
}

async function llmAnswer(
  agent: Agent,
  question: string,
  hits: RetrievalHit[],
) {
  const model = agent.modelName || defaultLlmModel();
  const context = hits
    .map(
      (hit, index) =>
        `[${index + 1}] ${hit.title}${hit.url ? ` (${hit.url})` : ""}\n${hit.content}`,
    )
    .join("\n\n");
  try {
    return await generateGroundedAnswer({
      model,
      systemPrompt: agent.systemPrompt,
      context,
      question,
      temperature: agent.temperature,
    });
  } catch (error) {
    logger.warn({ error, model }, "Ollama generation failed");
    return null;
  }
}

export async function answerQuestion(agent: Agent, question: string) {
  const pinned = await findPinnedAnswer(agent.id, question);
  if (pinned) {
    return {
      answer: pinned.answer,
      grounded: true,
      confidence: 1,
      citations: agent.showCitations
        ? [
            {
              chunkId: pinned.id,
              title: `Pinned: ${pinned.title}`,
              excerpt: pinned.answer.slice(0, 220),
            },
          ]
        : [],
    };
  }

  if (asksForLatestLink(question)) {
    const latest = await findLatestIndexedLink(agent.id);
    if (latest) {
      return {
        answer: `Here is the latest indexed post:\n[${latest.title}](${latest.url})`,
        grounded: true,
        confidence: 1,
        citations: agent.showCitations ? [latest] : [],
      };
    }
  }

  const hits = await hybridRetrieve(agent.id, question);
  const best = hits[0];
  const confidence = best
    ? Math.max(
        0,
        Math.min(
          1,
          best.vectorScore * 0.55 +
            Math.max(0, Math.min(best.keywordScore, 0.8)) * 0.25 +
            best.lexicalScore * 0.35,
        ),
      )
    : 0;
  const threshold = agent.strictMode ? 0.3 : 0.18;
  if (!best || confidence < threshold) {
    return {
      answer: agent.fallbackMessage,
      grounded: false,
      confidence,
      citations: [],
    };
  }

  const generated =
    agent.modelProvider === "ollama"
      ? await llmAnswer(agent, question, hits)
      : null;
  const answer = generated || extractiveAnswer(question, hits);
  if (!answer) {
    return {
      answer: agent.fallbackMessage,
      grounded: false,
      confidence,
      citations: [],
    };
  }
  return {
    answer,
    grounded: true,
    confidence,
    citations: agent.showCitations
      ? hits.slice(0, 4).map((hit) => ({
          chunkId: hit.chunkId,
          title: hit.title,
          url: hit.url,
          excerpt: hit.content.slice(0, 260),
        }))
      : [],
  };
}
