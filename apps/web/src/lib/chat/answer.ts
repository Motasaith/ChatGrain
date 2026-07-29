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
  grounded?: boolean | null;
  citations?: Array<{
    chunkId: string;
    title: string;
    url?: string;
    excerpt: string;
  }> | null;
};

export type ChatUiAction = {
  type: "lead_form";
  title: string;
  description: string;
  submitLabel: string;
};

const handoffAction: ChatUiAction = {
  type: "lead_form",
  title: "Ask the team to contact you",
  description:
    "Share an email address or phone number and your message will appear in the website team's Docent inbox.",
  submitLabel: "Request a reply",
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
      /^(?:category|categories|tag|tags|search|author|page|blog|articles|posts|project|projects|archive|archives)$/i.test(
        segment,
      ),
    );
    return segments.length + (segments.at(-1)!.length > 12 ? 1 : 0) -
      (generic ? 4 : 0);
  } catch {
    return -10;
  }
}

function sourceSpecificity(url: string, title: string) {
  const genericTitle =
    /\b(?:archives?|faq|about us|all projects|project library|project list|advanced view)\b/i.test(
      title,
    );
  return pageSpecificity(url) - (genericTitle ? 4 : 0);
}

export function asksForHumanSupport(question: string) {
  return (
    /\b(?:talk|speak|chat|connect|transfer|reach)\b.{0,45}\b(?:human|person|someone|support|admin|owner|agent|team|staff)\b/i.test(
      question,
    ) ||
    /\b(?:human|person|someone|support|admin|owner|agent|team|staff)\b.{0,45}\b(?:talk|speak|chat|contact|call|reply|reach)\b/i.test(
      question,
    ) ||
    /\b(?:phone number|direct email|email address)\b/i.test(question)
  );
}

function contactPageScore(hit: RetrievalHit) {
  let pathname = "";
  try {
    pathname = new URL(hit.url ?? "").pathname;
  } catch {
    // A title can still identify a contact page when no URL exists.
  }
  if (/\b(?:non-contact|contactless)\b/i.test(hit.title)) return -10;
  if (
    /(?:^|\/)contact(?:-us)?(?:\/|$)/i.test(pathname) ||
    /^(?:contact|contact us)(?:\s*[-|—].*)?$/i.test(hit.title.trim())
  ) {
    return 5;
  }
  if (
    /(?:^|\/)(?:support|help|help-center|customer-service)(?:\/|$)/i.test(
      pathname,
    ) ||
    /^(?:support|customer support|help center)(?:\s*[-|—].*)?$/i.test(
      hit.title.trim(),
    )
  ) {
    return 3;
  }
  if (
    /(?:^|\/)(?:about|about-us|faq)(?:\/|$)/i.test(pathname) ||
    /^(?:about us|faq)(?:\s*[-|—].*)?$/i.test(hit.title.trim())
  ) {
    return 1;
  }
  return -10;
}

function contactDetails(content: string) {
  const emails = [
    ...new Set(
      content.match(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      ) ?? [],
    ),
  ].slice(0, 2);
  const phones = [
    ...new Set(
      (content.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [])
        .map((value) => value.trim())
        .filter((value) => {
          const digits = value.replace(/\D/g, "").length;
          return digits >= 8 && digits <= 15;
        }),
    ),
  ].slice(0, 2);
  return { emails, phones };
}

async function humanSupportAnswer(agent: Agent) {
  const hits = await hybridRetrieve(
    agent.id,
    "contact us support email phone customer service",
    10,
  );
  const contactHit = hits
    .filter((hit) => hit.url)
    .sort((a, b) => contactPageScore(b) - contactPageScore(a))[0];
  const validContactHit =
    contactHit && contactPageScore(contactHit) > 0
      ? contactHit
      : undefined;
  const details =
    validContactHit && contactPageScore(validContactHit) >= 3
    ? contactDetails(validContactHit.content)
    : { emails: [], phones: [] };
  const direct = [
    details.emails.length
      ? `Email: ${details.emails.join(", ")}`
      : "",
    details.phones.length
      ? `Phone: ${details.phones.join(", ")}`
      : "",
  ].filter(Boolean);
  const contactLink =
    validContactHit?.url
      ? `\n\nYou can also use [${validContactHit.title}](${validContactHit.url}).`
      : "";
  return {
    answer:
      `I can ask the website team to contact you. Submit your details below and they can follow up.${direct.length ? `\n\n${direct.join("\n")}` : ""}${contactLink}`,
    grounded: true,
    confidence: 1,
    citations:
      agent.showCitations && validContactHit
        ? [{
            chunkId: validContactHit.chunkId,
            title: validContactHit.title,
            url: validContactHit.url,
            excerpt: validContactHit.content.slice(0, 260),
          }]
        : [],
    action: handoffAction,
  };
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
        Boolean(citation.url) &&
        sourceSpecificity(citation.url!, citation.title) > 0,
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
          sourceSpecificity(citation.url, citation.title) * 0.25 -
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

function cleanEvidenceSentence(value: string) {
  return value
    .replace(
      /(?:^|\s)(?:id|title|categories|_smart_summary|permalink):\s*/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function extractiveAnswer(question: string, hits: RetrievalHit[]) {
  const seen = new Set<string>();
  const selected = hits
    .slice(0, 4)
    .flatMap((hit, hitIndex) =>
      (hit.content.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [
        hit.content,
      ]).map((sentence) => ({
        hit,
        sentence: cleanEvidenceSentence(sentence),
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
    .slice(0, 2);
  return {
    answer: selected
      .map((item) => item.sentence)
      .join(" ")
      .slice(0, 800),
    hits: selected.map((item) => item.hit),
  };
}

function coherentEvidence(hits: RetrievalHit[]) {
  const best = hits[0];
  if (!best) return [];
  if (best.titleScore >= 0.5) {
    const sameDocument = hits
      .filter((hit) => hit.documentId === best.documentId)
      .slice(0, 5);
    if (sameDocument.length) return sameDocument;
  }
  return hits.slice(0, 5);
}

function citedEvidence(answer: string, hits: RetrievalHit[]) {
  const indices = [
    ...new Set(
      [...answer.matchAll(/\[([\d,\s]{1,30})\]/g)]
        .flatMap((match) => match[1].split(","))
        .map((value) => Number(value.trim()) - 1)
        .filter((index) => index >= 0 && index < hits.length),
    ),
  ];
  const selected = indices.length
    ? indices.map((index) => hits[index])
    : hits.slice(0, 2);
  const seen = new Set<string>();
  return selected
    .filter((hit) => {
      const key = hit.url || hit.documentId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

export function cleanGeneratedAnswer(answer: string) {
  return answer
    .replace(/\s*\[[\d,\s]{1,30}\](?=[\s,.;:!?)]|$)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  if (asksForHumanSupport(question)) {
    return humanSupportAnswer(agent);
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
        Boolean(hit.url) &&
        sourceSpecificity(hit.url!, hit.title) > 0,
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
          best.vectorScore * 0.4 +
            Math.max(0, Math.min(best.keywordScore, 0.8)) * 0.22 +
            best.lexicalScore * 0.2 +
            best.titleScore * 0.35,
        ),
      )
    : 0;
  const threshold = agent.strictMode ? 0.3 : 0.18;
  if (!best || confidence < threshold) {
    const previousFailures = history.filter(
      (message) =>
        message.role === "assistant" && message.grounded === false,
    ).length;
    return {
      answer:
        previousFailures > 0
          ? `${agent.fallbackMessage}\n\nIf you would like, leave your contact details and the website team can follow up.`
          : agent.fallbackMessage,
      grounded: false,
      confidence,
      citations: [],
      action: previousFailures > 0 ? handoffAction : undefined,
    };
  }

  const evidenceHits = coherentEvidence(hits);
  const generated =
    agent.modelProvider === "ollama"
      ? await llmAnswer(agent, question, evidenceHits, history)
      : null;
  const extracted = generated
    ? null
    : extractiveAnswer(question, evidenceHits);
  const answer = generated
    ? cleanGeneratedAnswer(generated)
    : extracted?.answer ?? "";
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
      ? (
          generated
            ? citedEvidence(generated, evidenceHits)
            : extracted?.hits ?? []
        ).map((hit) => ({
          chunkId: hit.chunkId,
          title: hit.title,
          url: hit.url,
          excerpt: hit.content.slice(0, 260),
        }))
      : [],
  };
}
