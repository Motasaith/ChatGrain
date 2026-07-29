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

function asksForContextualLink(question: string) {
  return (
    /\b(?:url|link)\b/i.test(question) &&
    /\b(?:this|that|it|article|post|page|one|above|mentioned)\b/i.test(
      question,
    )
  );
}

export type AnswerHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: Array<{
    chunkId: string;
    title: string;
    url?: string;
    excerpt: string;
  }> | null;
};

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

function pageSpecificity(value: string) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    if (!segments.length) return -10;
    const generic = segments.some((segment) =>
      /^(?:category|categories|tag|tags|search|author|page|blog|articles|posts)$/i.test(
        segment,
      ),
    );
    return segments.length + (segments.at(-1)!.length > 12 ? 1 : 0) -
      (generic ? 4 : 0);
  } catch {
    return -10;
  }
}

export function contextualCitation(
  question: string,
  history: AnswerHistoryMessage[],
) {
  if (!asksForContextualLink(question)) return null;
  const previous = [...history]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        message.citations?.some((citation) => citation.url),
    );
  if (!previous?.citations?.length) return null;
  const previousTerms = terms(previous.content);
  const candidates = previous.citations
    .filter(
      (citation): citation is typeof citation & { url: string } =>
        Boolean(citation.url) && pageSpecificity(citation.url!) > 0,
    )
    .map((citation, index) => {
      const evidenceTerms = terms(`${citation.title} ${citation.excerpt}`);
      const overlap = [...previousTerms].filter((term) =>
        evidenceTerms.has(term)
      ).length / Math.max(1, previousTerms.size);
      return {
        citation,
        score:
          overlap * 4 +
          pageSpecificity(citation.url) * 0.25 -
          index * 0.08,
      };
    })
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.citation ?? null;
}

function contextualRetrievalQuestion(
  question: string,
  history: AnswerHistoryMessage[],
) {
  const refersBack =
    /\b(?:this|that|it|its|they|their|them|those|these|above|previous|same)\b/i.test(
      question,
    ) ||
    /^(?:and|also|what about|how about|does|is|can|where|when)\b/i.test(
      question.trim(),
    );
  if (!refersBack) return question;
  const previousUser = [...history]
    .reverse()
    .find((message) => message.role === "user");
  return previousUser
    ? `${previousUser.content}\nFollow-up: ${question}`
    : question;
}

function conversationQuestion(
  question: string,
  history: AnswerHistoryMessage[],
) {
  if (!history.length) return question;
  const transcript = history
    .slice(-8)
    .map(
      (message) =>
        `${message.role === "user" ? "Customer" : "Assistant"}: ${message.content.slice(0, 800)}`,
    )
    .join("\n");
  return `Recent conversation:\n${transcript}\n\nCurrent customer question: ${question}`;
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
  history: AnswerHistoryMessage[],
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
      question: conversationQuestion(question, history),
      temperature: agent.temperature,
    });
  } catch (error) {
    logger.warn({ error, model }, "Ollama generation failed");
    return null;
  }
}

export async function answerQuestion(
  agent: Agent,
  question: string,
  history: AnswerHistoryMessage[] = [],
) {
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

  if (asksForContextualLink(question)) {
    const priorCitation = contextualCitation(question, history);
    if (priorCitation?.url) {
      return {
        answer: `Here is the article you were discussing:\n[${priorCitation.title}](${priorCitation.url})`,
        grounded: true,
        confidence: 1,
        citations: agent.showCitations ? [priorCitation] : [],
      };
    }
  }

  const retrievalQuestion = contextualRetrievalQuestion(question, history);
  const hits = await hybridRetrieve(agent.id, retrievalQuestion);
  if (asksForContextualLink(question)) {
    const specificHit = hits.find(
      (hit): hit is RetrievalHit & { url: string } =>
        Boolean(hit.url) && pageSpecificity(hit.url!) > 0,
    );
    if (specificHit) {
      const citation = {
        chunkId: specificHit.chunkId,
        title: specificHit.title,
        url: specificHit.url,
        excerpt: specificHit.content.slice(0, 260),
      };
      return {
        answer: `Here is the most relevant article:\n[${citation.title}](${citation.url})`,
        grounded: true,
        confidence: 0.9,
        citations: agent.showCitations ? [citation] : [],
      };
    }
  }
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
      ? await llmAnswer(agent, question, hits, history)
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
