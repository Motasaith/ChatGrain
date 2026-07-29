import {
  and,
  cosineDistance,
  desc,
  eq,
  isNotNull,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chunks, documents, sources } from "@/lib/db/schema";
import { embedText } from "./embeddings";

export type RetrievalHit = {
  chunkId: string;
  documentId: string;
  content: string;
  title: string;
  url?: string;
  vectorScore: number;
  keywordScore: number;
  score: number;
  position: number;
  lexicalScore: number;
  titleScore: number;
  rankScore: number;
};

const retrievalStopWords = new Set([
  "the",
  "and",
  "what",
  "where",
  "when",
  "which",
  "with",
  "from",
  "this",
  "that",
  "you",
  "your",
  "our",
  "are",
  "was",
  "were",
  "will",
  "does",
  "its",
  "how",
  "can",
  "could",
  "would",
  "please",
  "give",
  "have",
  "about",
  "need",
  "want",
  "more",
  "information",
  "info",
  "because",
  "working",
  "similar",
  "article",
  "articles",
  "website",
  "site",
  "know",
  "looking",
  "project",
  "projects",
  "raspberry",
]);

export function retrievalQueryTerms(query: string) {
  return [
    ...new Set(
      (query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
        (term) => !retrievalStopWords.has(term),
      ),
    ),
  ].slice(0, 24);
}

export async function findLatestIndexedLink(agentId: string) {
  const rows = await db
    .select({
      chunkId: chunks.id,
      content: chunks.content,
      title: documents.title,
      url: documents.canonicalUrl,
      metadata: documents.metadata,
      fetchedAt: documents.fetchedAt,
      rootUrl: sources.rootUrl,
    })
    .from(documents)
    .innerJoin(
      chunks,
      and(eq(chunks.documentId, documents.id), eq(chunks.position, 0)),
    )
    .innerJoin(sources, eq(sources.id, documents.sourceId))
    .where(
      and(
        eq(chunks.agentId, agentId),
        isNotNull(documents.canonicalUrl),
      ),
    )
    .limit(20_000);
  if (!rows.length) return null;

  const published = rows
    .map((row) => ({
      row,
      value: Date.parse(String(row.metadata?.publishedAt ?? "")),
    }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => b.value - a.value);
  const numeric = rows
    .map((row) => ({
      row,
      value: Number(row.metadata?.sortValue),
    }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => b.value - a.value);
  const crawled = rows
    .filter((row) => row.url !== row.rootUrl)
    .map((row) => ({
      row,
      value: Number(row.metadata?.crawlOrder),
    }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => a.value - b.value);
  const selected =
    published[0]?.row ??
    numeric[0]?.row ??
    crawled[0]?.row ??
    rows.sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0];
  if (!selected?.url) return null;
  return {
    chunkId: selected.chunkId,
    title: selected.title,
    url: selected.url,
    excerpt: selected.content.slice(0, 260),
  };
}

export async function hybridRetrieve(
  agentId: string,
  query: string,
  limit = 6,
): Promise<RetrievalHit[]> {
  const embedding = await embedText(query);
  const queryTerms = retrievalQueryTerms(query);
  const keywordQuery = queryTerms.length
    ? queryTerms.join(" OR ")
    : query;
  const termOverlap = (value: string) => {
    const lower = value.toLowerCase();
    return queryTerms.length
      ? queryTerms.filter((term) => lower.includes(term)).length /
          queryTerms.length
      : 0;
  };
  const lexicalScore = (title: string, content: string) =>
    termOverlap(`${title} ${content}`);
  const titleScore = (title: string) => termOverlap(title);
  const vectorSimilarity =
    sql<number>`1 - (${cosineDistance(chunks.embedding, embedding)})`;
  const keywordRank = sql<number>`
    ts_rank_cd(
      setweight(to_tsvector('english', coalesce(${documents.title}, '')), 'A')
      ||
      setweight(to_tsvector('english', ${chunks.content}), 'B'),
      websearch_to_tsquery('english', ${keywordQuery})
    )
    + case when ${chunks.position} = 0 then 0.08 else 0 end
    - case
        when ${chunks.content} ~* '(isbn|retrieved [0-9]|archived from|bibliography|references)'
        then 2.0
        else 0
      end
  `;
  const titleKeywordRank = sql<number>`
    ts_rank_cd(
      setweight(to_tsvector('english', coalesce(${documents.title}, '')), 'A'),
      websearch_to_tsquery('english', ${keywordQuery})
    )
  `;

  const [vectorRows, keywordRows, titleRows] = await Promise.all([
    db
      .select({
        chunkId: chunks.id,
        documentId: chunks.documentId,
        content: chunks.content,
        metadata: chunks.metadata,
        title: documents.title,
        url: documents.canonicalUrl,
        score: vectorSimilarity,
        position: chunks.position,
      })
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(
        and(eq(chunks.agentId, agentId), isNotNull(chunks.embedding)),
      )
      .orderBy(desc(vectorSimilarity))
      .limit(40),
    db
      .select({
        chunkId: chunks.id,
        documentId: chunks.documentId,
        content: chunks.content,
        metadata: chunks.metadata,
        title: documents.title,
        url: documents.canonicalUrl,
        score: keywordRank,
        position: chunks.position,
      })
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(
        and(
          eq(chunks.agentId, agentId),
          sql`(
            setweight(to_tsvector('english', coalesce(${documents.title}, '')), 'A')
            ||
            setweight(to_tsvector('english', ${chunks.content}), 'B')
          ) @@ websearch_to_tsquery('english', ${keywordQuery})`,
        ),
      )
      .orderBy(desc(keywordRank))
      .limit(40),
    db
      .select({
        chunkId: chunks.id,
        documentId: chunks.documentId,
        content: chunks.content,
        metadata: chunks.metadata,
        title: documents.title,
        url: documents.canonicalUrl,
        score: titleKeywordRank,
        position: chunks.position,
      })
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(
        and(
          eq(chunks.agentId, agentId),
          eq(chunks.position, 0),
          sql`to_tsvector('english', coalesce(${documents.title}, ''))
            @@ websearch_to_tsquery('english', ${keywordQuery})`,
        ),
      )
      .orderBy(desc(titleKeywordRank))
      .limit(30),
  ]);

  const combined = new Map<string, RetrievalHit>();
  vectorRows.forEach((row, index) => {
    combined.set(row.chunkId, {
      chunkId: row.chunkId,
      documentId: row.documentId,
      content: row.content,
      title: row.title,
      url: row.url ?? undefined,
      vectorScore: Number(row.score ?? 0),
      keywordScore: 0,
      score: 1 / (60 + index + 1),
      position: row.position,
      lexicalScore: lexicalScore(row.title, row.content),
      titleScore: titleScore(row.title),
      rankScore: 0,
    });
  });
  keywordRows.forEach((row, index) => {
    const existing = combined.get(row.chunkId);
    if (existing) {
      existing.keywordScore = Number(row.score ?? 0);
      existing.score += 1 / (60 + index + 1);
    } else {
      combined.set(row.chunkId, {
        chunkId: row.chunkId,
        documentId: row.documentId,
        content: row.content,
        title: row.title,
        url: row.url ?? undefined,
        vectorScore: 0,
        keywordScore: Number(row.score ?? 0),
        score: 1 / (60 + index + 1),
        position: row.position,
        lexicalScore: lexicalScore(row.title, row.content),
        titleScore: titleScore(row.title),
        rankScore: 0,
      });
    }
  });
  titleRows.forEach((row, index) => {
    const existing = combined.get(row.chunkId);
    if (existing) {
      existing.keywordScore = Math.max(
        existing.keywordScore,
        Number(row.score ?? 0),
      );
      existing.score += 1 / (60 + index + 1);
    } else {
      combined.set(row.chunkId, {
        chunkId: row.chunkId,
        documentId: row.documentId,
        content: row.content,
        title: row.title,
        url: row.url ?? undefined,
        vectorScore: 0,
        keywordScore: Number(row.score ?? 0),
        score: 1 / (60 + index + 1),
        position: row.position,
        lexicalScore: lexicalScore(row.title, row.content),
        titleScore: titleScore(row.title),
        rankScore: 0,
      });
    }
  });

  return [...combined.values()]
    .map((hit) => {
      hit.rankScore =
        hit.vectorScore * 0.45 +
        Math.max(-1, Math.min(hit.keywordScore, 1)) * 0.35 +
        hit.lexicalScore * 0.25 +
        hit.titleScore * 0.9 +
        (hit.position === 0 && hit.keywordScore > 0 ? 0.05 : 0);
      return hit;
    })
    .sort(
      (a, b) => b.rankScore - a.rankScore || b.score - a.score,
    )
    .slice(0, limit);
}
