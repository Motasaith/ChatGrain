import { eq, sql } from "drizzle-orm";
import type { Agent } from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { pinnedAnswers } from "@/lib/db/schema";
import {
  classifyConversationIntent,
  defaultLlmModel,
  describeImagesForSearch,
  generateGroundedAnswer,
  rewriteSearchQuery,
  streamGroundedAnswer,
} from "@/lib/llm/client";
import { suggestFollowUps } from "@/lib/chat/follow-ups";
import { providersForAgent } from "@/lib/llm/providers";
import { decryptSecret } from "@/lib/security/secrets";
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
    "Share an email address or phone number and your message will appear in the website team's ChatGrain inbox.",
  submitLabel: "Request a reply",
};

const TERM_STOP_WORDS = new Set([
  "the", "and", "that", "this", "with", "from", "your", "what", "when",
  "where", "how",
]);

/**
 * Crude singularisation, deliberately not a full stemmer.
 *
 * Without it a pinned answer for "refund policy" never fires for "do you
 * offer refunds", which is the same question. Only words over four characters
 * are touched, so "its", "was" and "gas" survive intact.
 */
function singular(word: string) {
  if (word.length <= 4 || !word.endsWith("s")) return word;
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) {
    return word;
  }
  return word.endsWith("es") && /(?:ch|sh|x|z|s)es$/.test(word)
    ? word.slice(0, -2)
    : word.slice(0, -1);
}

export function terms(value: string) {
  return new Set(
    (value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
      .filter((word) => !TERM_STOP_WORDS.has(word))
      .map(singular),
  );
}

/**
 * Similarity between a visitor's question and one phrasing of a pinned answer.
 *
 * Cosine-style, so a long pinned phrasing does not score highly against a
 * short question merely by containing it. Exported for testing: a pinned
 * answer is returned instead of running retrieval at all, so a false positive
 * silently replaces a correct answer.
 */
export function pinnedMatchScore(question: string, candidate: string) {
  const query = terms(question);
  const target = terms(candidate);
  if (!query.size || !target.size) return 0;
  const overlap = [...query].filter((word) => target.has(word)).length;
  return overlap / Math.max(1, Math.sqrt(query.size * target.size));
}

/** Below this a pin is a worse answer than retrieval. */
export const PINNED_MATCH_THRESHOLD = 0.72;

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

/**
 * People a visitor can ask to be put through to.
 *
 * The trailing `s?` is the whole reason this is shared rather than inlined:
 * without it "message the website admins" is not a handoff while "message the
 * website admin" is, and the plural is the more natural way to say it.
 */
const PERSON =
  "(?:a real person|human|person|people|someone|somebody|support|customer service|representative|admin|administrator|moderator|owner|agent|team|staff|webmaster)s?";

const REACH = "(?:talk|speak|chat|contact|call|email|message|reply|reach|get in touch)";

export function asksForHumanSupport(question: string) {
  const normalized = question
    .normalize("NFKC")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return (
    new RegExp(
      `\\b(?:talk|speak|chat|contact|call|email|message|connect|transfer|reach|get in touch)\\b.{0,60}\\b${PERSON}\\b`,
      "i",
    ).test(normalized) ||
    new RegExp(`\\b${PERSON}\\b.{0,60}\\b${REACH}\\b`, "i").test(normalized) ||
    new RegExp(
      `\\b(?:have|ask|get|tell|send)\\b.{0,30}\\b${PERSON}\\b.{0,30}\\b(?:contact|call|email|message|reply|reach)\\b`,
      "i",
    ).test(normalized) ||
    new RegExp(
      `\\b(?:send|pass|forward|relay)\\b.{0,40}\\b(?:message|note|query|question|feedback|request)\\b.{0,40}\\b${PERSON}\\b`,
      "i",
    ).test(normalized) ||
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

/**
 * Words that carry no question, only social contact.
 *
 * Split by kind because the reply differs: a greeting opens a conversation, a
 * thank-you closes an exchange, and a farewell closes the conversation.
 */
const GREETING_WORDS = new Set([
  "hi", "hii", "hiii", "hy", "hey", "heyy", "heya", "hello", "helo", "hallo",
  "yo", "sup", "howdy", "greetings", "morning", "afternoon", "evening",
  "salam", "salaam", "assalam", "assalamu", "assalamualaikum", "alaikum",
  "alaykum", "aoa", "adaab", "namaste", "hola", "bonjour", "ciao", "ola",
  "walaikum", "walaikumassalam", "walekum",
]);
const THANKS_WORDS = new Set([
  "thanks", "thank", "thankyou", "thx", "tysm", "ty", "shukriya", "shukria",
  "gracias", "merci", "danke", "cheers", "appreciate", "appreciated",
]);
const FAREWELL_WORDS = new Set([
  "bye", "byee", "goodbye", "cya", "farewell", "adios", "khuda", "hafiz",
  "allah", "later",
]);
/** Carried along with a greeting without turning it into a question. */
const SOCIAL_FILLER = new Set([
  "good", "day", "there", "you", "u", "ur", "your", "are", "is", "how", "hows",
  "doing", "well", "and", "the", "a", "an", "to", "me", "my", "i", "im", "am",
  "its", "it", "so", "much", "very", "lot", "lots", "for", "help", "helping",
  "team", "sir", "maam", "madam", "please", "plz", "pls", "ok", "okay", "k",
  "yes", "no", "hope", "everything", "all", "right", "again", "welcome",
  "nice", "great", "cool", "buddy", "bro", "dear", "kya", "haal", "hai",
  "kaise", "ho", "aap", "acha", "theek",
  // Connectors inside transliterated greetings: "assalam o alaikum".
  "o", "wa",
]);

export type SmallTalkKind = "greeting" | "thanks" | "farewell";

/**
 * Recognises a message that is only social, so it can be answered directly.
 *
 * Retrieval on "hi" scores nothing above the threshold and returns the
 * fallback, so a visitor's first word is met with "I couldn't find a reliable
 * answer" - the worst possible opening. This runs before retrieval.
 *
 * A message is only small talk when *nothing* is left after the social words
 * are removed, so "hi, do you have an EML viewer?" is still a question.
 */
export function smallTalkKind(question: string): SmallTalkKind | null {
  const words =
    question
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[’']/g, "")
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return "greeting";
  if (words.length > 8) return null;

  let kind: SmallTalkKind | null = null;
  for (const word of words) {
    // Later words win, so "hi, thanks" closes rather than opens.
    if (GREETING_WORDS.has(word)) kind = kind === null ? "greeting" : kind;
    else if (THANKS_WORDS.has(word)) kind = "thanks";
    else if (FAREWELL_WORDS.has(word)) kind = "farewell";
    else if (!SOCIAL_FILLER.has(word)) return null;
  }
  return kind;
}

function smallTalkAnswer(
  agent: Agent,
  kind: SmallTalkKind,
): AnswerResult {
  const answer =
    kind === "greeting"
      ? agent.welcomeMessage
      : kind === "thanks"
        ? "Happy to help. Is there anything else you would like to know?"
        : "Thanks for stopping by. Come back any time you need a hand.";
  return {
    answer,
    // Nothing was retrieved, but nothing was missed either: this is a complete
    // reply, and marking it ungrounded would make the next unanswered question
    // look like a repeated failure and offer the contact form too early.
    grounded: true,
    confidence: 1,
    citations: [],
    followUps:
      kind === "greeting" && agent.suggestedQuestions.length
        ? agent.suggestedQuestions.slice(0, 4)
        : undefined,
  };
}

async function shouldOfferHumanHandoff(
  agent: Agent,
  question: string,
  history: AnswerHistoryMessage[],
) {
  if (asksForHumanSupport(question)) return true;
  const intent = await classifyConversationIntent({
    // Everything up to and including the last handoff is dropped, exactly as
    // `conversationQuestion` does it. A handoff turn left in the window reads
    // as an unresolved request to reach a person, so the classifier keeps
    // answering HUMAN_HANDOFF to whatever is asked next - and the visitor gets
    // the contact form instead of an answer for the rest of the conversation.
    history: afterLastHandoff(history).map(({ role, content }) => ({
      role,
      content,
    })),
    message: question,
    providers: providersForAgent({
      llmBaseUrl: agent.llmBaseUrl,
      llmApiKey: decryptSecret(agent.llmApiKeyEncrypted),
      modelName: agent.modelName,
    }),
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

/**
 * History since the last human-handoff turn.
 *
 * A handoff exchange is a dead end for everything downstream: it is not the
 * topic the visitor is asking about, and it reads as an open request to reach a
 * person. Both retrieval and intent routing have to start after it.
 *
 * Exported for testing: leaving a handoff turn in the window makes the intent
 * classifier answer HUMAN_HANDOFF to every later message, which replaces the
 * rest of the conversation with the contact form and is invisible from here.
 */
export function afterLastHandoff(history: AnswerHistoryMessage[]) {
  return history.slice(history.findLastIndex(isHandoffHistoryMessage) + 1);
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
  const relevantHistory = afterLastHandoff(history);
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
  let best:
    | { id: string; title: string; answer: string; score: number }
    | undefined;
  for (const entry of entries) {
    for (const candidate of entry.questions) {
      const score = pinnedMatchScore(question, candidate);
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
  if (!best || best.score < PINNED_MATCH_THRESHOLD) return null;
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

/** How much the best hit looks like an answer rather than a near miss. */
export function retrievalConfidence(best: RetrievalHit | undefined) {
  if (!best) return 0;
  return Math.max(
    0,
    Math.min(
      1,
      best.vectorScore * 0.4 +
        Math.max(0, Math.min(best.keywordScore, 0.8)) * 0.22 +
        best.lexicalScore * 0.2 +
        best.titleScore * 0.35,
    ),
  );
}

/**
 * Retrieval, with one repair attempt when the first pass finds nothing good.
 *
 * A misspelled word costs more than it looks like it should: the keyword,
 * lexical and title legs together carry more of the confidence score than the
 * vector leg does, and none of them match a word that is spelled wrong. The
 * rewrite runs only on that failure, so a question that already worked pays
 * nothing for this.
 */
async function retrieveWithRepair(
  agent: Agent,
  retrievalQuestion: string,
  question: string,
  threshold: number,
) {
  // An overview question needs a wide net: the answer is distributed across
  // pages rather than concentrated in one, so the usual handful truncates it.
  const limit = asksForCorpusOverview(question)
    ? OVERVIEW_RETRIEVAL_LIMIT
    : undefined;
  const hits = await hybridRetrieve(agent.id, retrievalQuestion, limit);
  const confidence = retrievalConfidence(hits[0]);
  if (confidence >= threshold) return { hits, confidence };

  const rewritten = await rewriteSearchQuery({
    question,
    providers: providersForAgent({
      llmBaseUrl: agent.llmBaseUrl,
      llmApiKey: decryptSecret(agent.llmApiKeyEncrypted),
      modelName: agent.modelName,
    }),
  });
  const changed =
    rewritten &&
    rewritten.toLowerCase().replace(/\W+/g, " ").trim() !==
      question.toLowerCase().replace(/\W+/g, " ").trim();
  if (!changed) return { hits, confidence };

  const repaired = await hybridRetrieve(agent.id, rewritten, limit);
  const repairedConfidence = retrievalConfidence(repaired[0]);
  // Keep the better of the two. A rewrite can drop a distinctive term the
  // visitor actually typed, and that is worse than the original miss.
  return repairedConfidence > confidence
    ? { hits: repaired, confidence: repairedConfidence }
    : { hits, confidence };
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

/**
 * Questions about the corpus as a whole rather than about one page.
 *
 * "How many viewers are there" cannot be answered from the handful of chunks
 * that serve a normal question: the answer is spread across every category
 * page, and six chunks reach six of them. The model then counts what it was
 * given and reports a confident undercount, which reads as a hallucination and
 * is really a truncated question.
 */
export function asksForCorpusOverview(question: string) {
  return (
    /\b(?:how many|complete list|full list|entire list|list them all)\b/i.test(
      question,
    ) ||
    /\b(?:list|show|name|tell me)\b.{0,20}\b(?:all|every|each)\b/i.test(
      question,
    ) ||
    /\b(?:all|every)\b.{0,25}\b(?:formats?|file types?|viewers?|tools?|categories|services?|products?|pages?|articles?)\b/i.test(
      question,
    ) ||
    /\b(?:what|which)\b.{0,20}\b(?:formats?|file types?|viewers?|tools?|categories)\b.{0,30}\b(?:support(?:s|ed)?|available|offer(?:s|ed)?|have|has|there)\b/i.test(
      question,
    )
  );
}

/** Chunks pulled for an overview question, against 6 for a normal one. */
const OVERVIEW_RETRIEVAL_LIMIT = 40;
/** Distinct pages handed to the model for an overview question. */
const OVERVIEW_EVIDENCE_PAGES = 14;

function asksForRelatedContent(question: string) {
  return /\b(?:similar|related|alternative|another|other|more like|recommend)\b/i.test(
    question,
  );
}

function coherentEvidence(hits: RetrievalHit[], question: string) {
  const best = hits[0];
  if (!best) return [];
  // Before the single-document branch below: an overview question is the one
  // case where narrowing to the best-matching page is exactly wrong.
  if (asksForCorpusOverview(question)) {
    const seen = new Set<string>();
    return hits
      .filter((hit) => {
        if (seen.has(hit.documentId)) return false;
        seen.add(hit.documentId);
        return true;
      })
      .slice(0, OVERVIEW_EVIDENCE_PAGES);
  }
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
      // The agent's own key first, then the installation's chain, so a
      // customer whose quota runs out still gets an answer.
      providers: providersForAgent({
        llmBaseUrl: agent.llmBaseUrl,
        llmApiKey: decryptSecret(agent.llmApiKeyEncrypted),
        modelName: agent.modelName,
      }),
    });
  } catch (error) {
    logger.warn({ error, model }, "Ollama generation failed");
    return { status: "unavailable" } as const;
  }
}

/**
 * Distinct pages worth offering when the question itself cannot be answered.
 *
 * Deduplicated per document, because five chunks of one page is a list of one
 * thing presented as five.
 */
function alternativePages(hits: RetrievalHit[], limit = 5) {
  const seen = new Set<string>();
  return hits
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
    .slice(0, limit);
}

/**
 * The reply when the model read the evidence and said it does not answer the
 * question.
 *
 * The old behaviour here was to run the extractive fallback, which pastes the
 * highest-scoring sentences from those same pages. Asked for a format the site
 * does not support, that produced a wall of run-together viewer names: a
 * confident-looking non-answer to a question whose true answer is "no". Saying
 * so and listing what does exist is both honest and more useful.
 */
function unsupportedAnswer(
  agent: Agent,
  hits: RetrievalHit[],
  confidence: number,
): AnswerResult {
  const pages = alternativePages(hits);
  const list = pages
    .map((hit) => `- [${hit.title}](${hit.url})`)
    .join("\n");
  return {
    answer: pages.length
      ? `${agent.fallbackMessage}\n\nHere is what this website does cover:\n${list}`
      : agent.fallbackMessage,
    grounded: false,
    confidence,
    citations: [],
  };
}

export async function answerQuestion(
  agent: Agent,
  question: string,
  history: AnswerHistoryMessage[] = [],
  images: Array<{ mimeType: string; base64: string }> = [],
  cachedVisualSearchText?: string | null,
) {
  // Before the handoff check, which would otherwise spend a round-trip
  // classifying "hi", and before retrieval, which has nothing to find in it.
  const social = images.length ? null : smallTalkKind(question);
  if (social) return smallTalkAnswer(agent, social);

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
  const threshold = agent.strictMode ? 0.3 : 0.18;
  // An image already produced its own search text, and a picture cannot be
  // misspelled, so the repair pass only applies to typed questions.
  const { hits, confidence } = images.length
    ? await hybridRetrieve(agent.id, retrievalQuestion).then((found) => ({
        hits: found,
        confidence: retrievalConfidence(found[0]),
      }))
    : await retrieveWithRepair(agent, retrievalQuestion, question, threshold);
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
    if (generated.status === "answered") {
      return {
        answer: addRequestedEvidenceLinks(
          cleanGeneratedAnswer(generated.text),
          question,
          imageEvidence,
        ),
        grounded: true,
        confidence: Math.max(confidence, 0.75),
        citations: agent.showCitations
          ? citedEvidence(generated.text, imageEvidence).map((hit) => ({
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
      : ({ status: "unavailable" } as const);

  // Retrieval found pages, but the model judged that they do not answer this.
  // Only the extractive path could contradict that, and it does so by pasting
  // the very text the model just rejected.
  if (generated.status === "declined") {
    return unsupportedAnswer(agent, evidenceHits, confidence);
  }

  const answered = generated.status === "answered" ? generated.text : null;
  const listFallback = answered
    ? null
    : projectListFallback(question, evidenceHits);
  const extracted = answered
    ? null
    : listFallback
      ? null
      : extractiveAnswer(question, evidenceHits);
  const answer = answered
    ? addRequestedEvidenceLinks(
        cleanGeneratedAnswer(answered),
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
  const answeredHits = answered
    ? citedEvidence(answered, evidenceHits)
    : listFallback?.hits ?? extracted?.hits ?? [];
  return {
    answer,
    grounded: true,
    confidence,
    citations: agent.showCitations
      ? answeredHits.map((hit) => ({
          chunkId: hit.chunkId,
          title: hit.title,
          url: hit.url,
          excerpt: hit.content.slice(0, 260),
        }))
      : [],
    followUps: agent.followUpSuggestions
      ? suggestFollowUps({
          hits,
          question,
          // Pages this answer already covered are not a next step.
          answeredDocumentIds: [
            ...answeredHits.map((hit) => hit.documentId),
            ...evidenceHits.map((hit) => hit.documentId),
          ],
        })
      : undefined,
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
  /** Tappable next questions, all answerable from the current index. */
  followUps?: string[];
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
    const social = smallTalkKind(question);
    if (social) return smallTalkAnswer(agent, social);
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
  const threshold = agent.strictMode ? 0.3 : 0.18;
  const { hits, confidence } = await retrieveWithRepair(
    agent,
    retrievalQuestion,
    question,
    threshold,
  );
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

  const answeredHits = generated
    ? citedEvidence(generated, evidenceHits)
    : listFallback?.hits ?? extracted?.hits ?? [];
  yield {
    type: "final",
    answer,
    grounded: true,
    confidence,
    followUps: agent.followUpSuggestions
      ? suggestFollowUps({
          hits,
          question,
          answeredDocumentIds: [
            ...answeredHits.map((hit) => hit.documentId),
            ...evidenceHits.map((hit) => hit.documentId),
          ],
        })
      : undefined,
    citations: agent.showCitations
      ? answeredHits.map((hit) => ({
          chunkId: hit.chunkId,
          title: hit.title,
          url: hit.url,
          excerpt: hit.content.slice(0, 260),
        }))
      : [],
  };
}
