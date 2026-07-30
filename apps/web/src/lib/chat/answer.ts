import { eq, sql } from "drizzle-orm";
import type { Agent } from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { pinnedAnswers } from "@/lib/db/schema";
import {
  classifyConversationIntent,
  defaultLlmModel,
  describeImagesForSearch,
  generateGroundedAnswer,
  streamGroundedAnswer,
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

export function referencesConversationImage(question: string) {
  return /\b(?:image|images|pic|pics|picture|photo|screenshot|diagram|circuit|attached|attachment|above|shown|visible|given)\b/i.test(
    question,
  ) ||
    /\b(?:this|that|it|same)\b.{0,35}\b(?:post|article|page|project|product)\b/i.test(
      question,
    );
}

export function asksToFindPageFromImage(question: string) {
  return referencesConversationImage(question) &&
    /\b(?:find|locate|identify|match|search|which|where|link|url|post|article|page|project|product)\b/i.test(
      question,
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
  const normalized = question
    .normalize("NFKC")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return (
    /\b(?:talk|speak|chat|contact|call|email|message|connect|transfer|reach|get in touch)\b.{0,60}\b(?:a real person|human|person|someone|support|customer service|representative|admin|owner|agent|team|staff)\b/i.test(
      normalized,
    ) ||
    /\b(?:a real person|human|person|someone|support|customer service|representative|admin|owner|agent|team|staff)\b.{0,60}\b(?:talk|speak|chat|contact|call|email|message|reply|reach|get in touch)\b/i.test(
      normalized,
    ) ||
    /\b(?:have|ask|get|tell)\b.{0,30}\b(?:someone|support|customer service|admin|owner|agent|team|staff)\b.{0,30}\b(?:contact|call|email|message|reply|reach)\b/i.test(
      normalized,
    ) ||
    /\b(?:phone number|direct email|email address|contact details)\b/i.test(
      normalized,
    ) ||
    /\b(?:mujhe|mujhse|mujh se|humain|hamein|hamain|kisi)\b.{0,55}\b(?:insan|insaan|banda|banday|bande|support|admin|owner|agent|team|staff)\b.{0,55}\b(?:baat|bat|rabta|raabta|contact|call|reply)\b/i.test(
      normalized,
    ) ||
    /\b(?:support|admin|owner|agent|team|staff|insan|insaan|banda|banday|bande)\b.{0,55}\b(?:se|say)\b.{0,35}\b(?:baat|bat|rabta|raabta|contact)\b/i.test(
      normalized,
    ) ||
    /\b(?:koi|ap|aap)\b.{0,35}\b(?:mujhe|mujhse|mujh se)\b.{0,35}\b(?:contact|call|reply|rabta|raabta)\b/i.test(
      normalized,
    ) ||
    /(?:انسان|شخص|ایڈمن|مالک|سپورٹ|نمائندہ|ٹیم).{0,60}(?:بات|رابطہ|کال|ای میل)/u.test(
      normalized,
    ) ||
    /(?:بات|رابطہ|کال|ای میل).{0,60}(?:انسان|شخص|ایڈمن|مالک|سپورٹ|نمائندہ|ٹیم)/u.test(
      normalized,
    )
  );
}

async function shouldOfferHumanHandoff(
  agent: Agent,
  question: string,
  history: AnswerHistoryMessage[],
) {
  if (asksForHumanSupport(question)) return true;
  const intent = await classifyConversationIntent({
    message: question,
    history: history.map(({ role, content }) => ({ role, content })),
    model: agent.modelName,
  });
  return intent === "human_handoff";
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

function isHandoffHistoryMessage(message: AnswerHistoryMessage) {
  return message.role === "user"
    ? asksForHumanSupport(message.content)
    : /\b(?:ask the website team to contact you|submit your details below|request sent)\b/i.test(
        message.content,
      );
}

function standaloneTopicTerms(value: string) {
  const ignored = new Set([
    "want",
    "more",
    "information",
    "about",
    "because",
    "working",
    "similar",
    "article",
    "website",
    "this",
    "that",
    "these",
    "those",
    "they",
    "their",
    "them",
    "with",
    "from",
    "have",
    "does",
    "what",
    "where",
    "when",
    "which",
    "could",
    "would",
    "please",
    "tell",
    "project",
  ]);
  return [
    ...new Set(
      (value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
        .filter((term) => !ignored.has(term)),
    ),
  ];
}

export function contextualRetrievalQuestion(
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
  if (standaloneTopicTerms(question).length >= 3) return question;
  const previousUser = [...history]
    .reverse()
    .find(
      (message) =>
        message.role === "user" && !isHandoffHistoryMessage(message),
    );
  return previousUser
    ? `${previousUser.content}\nFollow-up: ${question}`
    : question;
}

function conversationQuestion(
  question: string,
  history: AnswerHistoryMessage[],
) {
  if (!history.length) return question;
  const lastHandoff = history.findLastIndex(isHandoffHistoryMessage);
  const relevantHistory = history.slice(lastHandoff + 1);
  if (!relevantHistory.length) return question;
  const transcript = relevantHistory
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

function cleanEvidenceDescription(value: string) {
  const cleaned = value
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^\s*(?:id|title|categories|permalink):/i.test(line),
    )
    .join(" ")
    .replace(/^\s*_smart_summary:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleanEvidenceSentence(
    cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/)?.[0] ?? cleaned,
  ).slice(0, 220);
}

function requestedListCount(question: string) {
  const numeric = question.match(/\b(?:list|enlist|suggest|recommend|show|give|find)?\s*(10|[2-9])\b/i);
  if (numeric) return Math.min(10, Number(numeric[1]));
  const words: Record<string, number> = {
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
  };
  const word = question.match(/\b(two|three|four|five|six)\b/i)?.[1];
  return word ? words[word.toLowerCase()] : null;
}

function requestedProjectList(question: string) {
  const count = requestedListCount(question);
  return count &&
      /\b(?:project|article|post|product|resource)s?\b/i.test(question)
    ? count
    : null;
}

export function projectListFallback(
  question: string,
  hits: RetrievalHit[],
) {
  const count = requestedProjectList(question);
  if (!count) return null;
  const seen = new Set<string>();
  const projects = hits
    .filter((hit): hit is RetrievalHit & { url: string } => {
      if (
        !hit.url ||
        seen.has(hit.documentId) ||
        sourceSpecificity(hit.url, hit.title) <= 0
      ) {
        return false;
      }
      seen.add(hit.documentId);
      return true;
    })
    .slice(0, count);
  if (!projects.length) return null;
  const qualification =
    projects.length < count
      ? `I found ${projects.length} clearly relevant indexed ${projects.length === 1 ? "project" : "projects"}:`
      : `Here are ${projects.length} relevant projects:`;
  return {
    answer: `${qualification}\n\n${projects
      .map((hit) => {
        const description = cleanEvidenceDescription(hit.content);
        return `- [${hit.title}](${hit.url})${description ? ` — ${description}` : ""}`;
      })
      .join("\n")}`,
    hits: projects,
  };
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
  // Sentences are deduplicated above, but two of them can be drawn from the
  // same chunk, which would cite that one source twice.
  const citedChunks = new Set<string>();
  return {
    answer: selected
      .map((item) => item.sentence)
      .join(" ")
      .slice(0, 800),
    hits: selected
      .map((item) => item.hit)
      .filter((hit) => {
        if (citedChunks.has(hit.chunkId)) return false;
        citedChunks.add(hit.chunkId);
        return true;
      }),
  };
}

function asksForRelatedContent(question: string) {
  return /\b(?:similar|related|alternative|another|other|more like|recommend)\b/i.test(
    question,
  );
}

function coherentEvidence(hits: RetrievalHit[], question: string) {
  const best = hits[0];
  if (!best) return [];
  if (asksForRelatedContent(question) || requestedProjectList(question)) {
    const seen = new Set<string>();
    return hits
      .filter((hit) => {
        const key = hit.documentId;
        if (
          seen.has(key) ||
          (hit.url && sourceSpecificity(hit.url, hit.title) <= 0)
        ) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, 5);
  }
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

export function addRequestedEvidenceLinks(
  answer: string,
  question: string,
  hits: RetrievalHit[],
) {
  const requested =
    asksForRelatedContent(question) ||
    /\b(?:article|link|url|page|post)\b/i.test(question);
  if (!requested || /https?:\/\/\S+/i.test(answer)) return answer;
  const seen = new Set<string>();
  const links = hits
    .filter((hit): hit is RetrievalHit & { url: string } => {
      if (
        !hit.url ||
        seen.has(hit.url) ||
        sourceSpecificity(hit.url, hit.title) <= 0
      ) {
        return false;
      }
      seen.add(hit.url);
      return true;
    })
    .slice(0, asksForRelatedContent(question) ? 5 : 1);
  if (!links.length) return answer;
  return `${answer}\n\n${links.length > 1 ? "Related pages" : "Source"}:\n${links
    .map((hit) => `- [${hit.title}](${hit.url})`)
    .join("\n")}`;
}

async function llmAnswer(
  agent: Agent,
  question: string,
  hits: RetrievalHit[],
  history: AnswerHistoryMessage[],
  images: Array<{ mimeType: string; base64: string }>,
) {
  const model =
    (images.length ? process.env.VISION_LLM_MODEL?.trim() : "") ||
    agent.modelName ||
    defaultLlmModel();
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
      images,
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
  images: Array<{ mimeType: string; base64: string }> = [],
  cachedVisualSearchText?: string | null,
) {
  if (await shouldOfferHumanHandoff(agent, question, history)) {
    return humanSupportAnswer(agent);
  }

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

  if (!images.length && asksForContextualLink(question)) {
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

  const visualSearchText =
    cachedVisualSearchText?.trim() ||
    (images.length
      ? await describeImagesForSearch({
          model:
            process.env.VISION_LLM_MODEL?.trim() ||
            agent.modelName ||
            defaultLlmModel(),
          images,
        })
      : null);
  const retrievalQuestion = [
    visualSearchText,
    contextualRetrievalQuestion(question, history),
  ]
    .filter(Boolean)
    .join("\n");
  const hits = await hybridRetrieve(agent.id, retrievalQuestion);
  if (images.length && asksToFindPageFromImage(question)) {
    const matched = hits.find(
      (hit): hit is RetrievalHit & { url: string } =>
        Boolean(hit.url) &&
        sourceSpecificity(hit.url!, hit.title) > 0 &&
        (
          hit.titleScore >= 0.34 ||
          (hit.titleScore >= 0.2 && hit.lexicalScore >= 0.2)
        ),
    );
    if (matched) {
      const citation = {
        chunkId: matched.chunkId,
        title: matched.title,
        url: matched.url,
        excerpt: matched.content.slice(0, 260),
      };
      return {
        answer: `I found the matching page:\n[${matched.title}](${matched.url})`,
        grounded: true,
        confidence: Math.max(0.9, matched.titleScore),
        citations: agent.showCitations ? [citation] : [],
      };
    }
    return {
      answer: visualSearchText
        ? `I could read “${visualSearchText}” from the image, but I couldn’t match it confidently to an indexed page on this website.`
        : "I couldn’t read enough identifying text from the image to match it confidently to an indexed page on this website.",
      grounded: false,
      confidence: 0,
      citations: [],
    };
  }
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
  if (images.length) {
    const imageEvidence = hits.length
      ? coherentEvidence(hits, question)
      : [];
    const generated = await llmAnswer(
      agent,
      question,
      imageEvidence,
      history,
      images,
    );
    if (generated) {
      return {
        answer: addRequestedEvidenceLinks(
          cleanGeneratedAnswer(generated),
          question,
          imageEvidence,
        ),
        grounded: true,
        confidence: Math.max(confidence, 0.75),
        citations: agent.showCitations
          ? citedEvidence(generated, imageEvidence).map((hit) => ({
              chunkId: hit.chunkId,
              title: hit.title,
              url: hit.url,
              excerpt: hit.content.slice(0, 260),
            }))
          : [],
      };
    }
  }
  if (!best || confidence < threshold) {
    const previousAssistant = [...history]
      .reverse()
      .find((message) => message.role === "assistant");
    const repeatedFailure = previousAssistant?.grounded === false;
    return {
      answer:
        repeatedFailure
          ? `${agent.fallbackMessage}\n\nIf you would like, leave your contact details and the website team can follow up.`
          : agent.fallbackMessage,
      grounded: false,
      confidence,
      citations: [],
      action: repeatedFailure ? handoffAction : undefined,
    };
  }

  const evidenceHits = coherentEvidence(hits, question);
  const generated =
    agent.modelProvider === "ollama"
      ? await llmAnswer(agent, question, evidenceHits, history, images)
      : null;
  const listFallback = generated
    ? null
    : projectListFallback(question, evidenceHits);
  const extracted = generated
    ? null
    : listFallback
      ? null
      : extractiveAnswer(question, evidenceHits);
  const answer = generated
    ? addRequestedEvidenceLinks(
        cleanGeneratedAnswer(generated),
        question,
        evidenceHits,
      )
    : listFallback?.answer ?? extracted?.answer ?? "";
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
            : listFallback?.hits ?? extracted?.hits ?? []
        ).map((hit) => ({
          chunkId: hit.chunkId,
          title: hit.title,
          url: hit.url,
          excerpt: hit.content.slice(0, 260),
        }))
      : [],
  };
}

export type AnswerCitation = {
  chunkId: string;
  title: string;
  url?: string;
  excerpt: string;
};

export type AnswerResult = {
  answer: string;
  grounded: boolean;
  confidence: number;
  citations: AnswerCitation[];
  action?: ChatUiAction;
};

export type AnswerStreamEvent =
  /** Incremental model output, safe to speak and to render as it arrives. */
  | { type: "delta"; text: string }
  /** Authoritative result; replaces any accumulated delta text. */
  | ({ type: "final" } & AnswerResult);

/**
 * Streaming counterpart of `answerQuestion`, built for the realtime voice
 * gateway.
 *
 * Only the model-generated branch can stream. Every other branch (handoff,
 * pinned answers, direct link lookups, retrieval fallbacks) resolves in a
 * single step, so those yield just a `final` event.
 */
export async function* answerQuestionStream(
  agent: Agent,
  question: string,
  history: AnswerHistoryMessage[] = [],
  { voice = false, signal }: { voice?: boolean; signal?: AbortSignal } = {},
): AsyncGenerator<AnswerStreamEvent> {
  const nonStreaming = async (): Promise<AnswerResult | null> => {
    if (await shouldOfferHumanHandoff(agent, question, history)) {
      return humanSupportAnswer(agent);
    }
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
    return null;
  };

  const shortcut = await nonStreaming();
  if (shortcut) {
    yield { type: "final", ...shortcut };
    return;
  }
  if (signal?.aborted) return;

  const retrievalQuestion = contextualRetrievalQuestion(question, history);
  const hits = await hybridRetrieve(agent.id, retrievalQuestion);
  if (signal?.aborted) return;

  if (asksForContextualLink(question)) {
    const specificHit = hits.find(
      (hit): hit is RetrievalHit & { url: string } =>
        Boolean(hit.url) && sourceSpecificity(hit.url!, hit.title) > 0,
    );
    if (specificHit) {
      const citation = {
        chunkId: specificHit.chunkId,
        title: specificHit.title,
        url: specificHit.url,
        excerpt: specificHit.content.slice(0, 260),
      };
      yield {
        type: "final",
        answer: `Here is the most relevant article:\n[${citation.title}](${citation.url})`,
        grounded: true,
        confidence: 0.9,
        citations: agent.showCitations ? [citation] : [],
      };
      return;
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
    const previousAssistant = [...history]
      .reverse()
      .find((message) => message.role === "assistant");
    const repeatedFailure = previousAssistant?.grounded === false;
    yield {
      type: "final",
      answer: repeatedFailure
        ? `${agent.fallbackMessage}\n\nIf you would like, leave your contact details and the website team can follow up.`
        : agent.fallbackMessage,
      grounded: false,
      confidence,
      citations: [],
      action: repeatedFailure ? handoffAction : undefined,
    };
    return;
  }

  const evidenceHits = coherentEvidence(hits, question);
  const context = evidenceHits
    .map(
      (hit, index) =>
        `[${index + 1}] ${hit.title}${hit.url ? ` (${hit.url})` : ""}\n${hit.content}`,
    )
    .join("\n\n");

  // An empty `generated` means the model produced nothing usable, which sends
  // the answer down the same retrieval fallbacks the non-streaming path uses.
  let generated = "";

  if (agent.modelProvider === "ollama") {
    try {
      for await (const chunk of streamGroundedAnswer({
        model: agent.modelName || defaultLlmModel(),
        systemPrompt: agent.systemPrompt,
        context,
        question: conversationQuestion(question, history),
        temperature: agent.temperature,
        voice,
        signal,
      })) {
        if (chunk.type === "insufficient") {
          generated = "";
          break;
        }
        if (chunk.type === "delta") {
          yield { type: "delta", text: chunk.text };
        }
        if (chunk.type === "done") generated = chunk.text;
      }
    } catch (error) {
      if (signal?.aborted) return;
      logger.warn({ error }, "Streaming voice generation failed");
      generated = "";
    }
  }

  if (signal?.aborted) return;

  const listFallback = generated
    ? null
    : projectListFallback(question, evidenceHits);
  const extracted =
    generated || listFallback ? null : extractiveAnswer(question, evidenceHits);
  const answer = generated
    ? addRequestedEvidenceLinks(
        cleanGeneratedAnswer(generated),
        question,
        evidenceHits,
      )
    : listFallback?.answer ?? extracted?.answer ?? "";

  if (!answer) {
    yield {
      type: "final",
      answer: agent.fallbackMessage,
      grounded: false,
      confidence,
      citations: [],
    };
    return;
  }

  yield {
    type: "final",
    answer,
    grounded: true,
    confidence,
    citations: agent.showCitations
      ? (
          generated
            ? citedEvidence(generated, evidenceHits)
            : listFallback?.hits ?? extracted?.hits ?? []
        ).map((hit) => ({
          chunkId: hit.chunkId,
          title: hit.title,
          url: hit.url,
          excerpt: hit.content.slice(0, 260),
        }))
      : [],
  };
}
