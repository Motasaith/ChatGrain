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
import { retrievalQueryTerms, siteStopWords } from "./query-terms";
import { titlePrecision } from "./title";

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
  /** Share of the title the query accounts for; separates exact from padded. */
  titlePrecision: number;
  rankScore: number;
};

/**
 * The site's own vocabulary, cached per agent.
 *
 * Fetching the source roots on every message would add a query to a path that
 * already runs an embedding plus three searches, and a site's domain changes
 * about never.
 */
const siteWordCache = new Map<string, { words: Set<string>; expiresAt: number }>();
const SITE_WORD_TTL_MS = 5 * 60_000;

export function clearSiteWordCache() {
  siteWordCache.clear();
}

async function agentSiteWords(agentId: string) {
  const cached = siteWordCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) return cached.words;
  const rows = await db
    .select({ rootUrl: sources.rootUrl })
    .from(sources)
    .where(eq(sources.agentId, agentId));
  const words = siteStopWords(
    rows.map((row) => row.rootUrl).filter((url): url is string => Boolean(url)),
  );
  siteWordCache.set(agentId, {
    words,
    expiresAt: Date.now() + SITE_WORD_TTL_MS,
  });
  return words;
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
  // The embedding and the site vocabulary are independent, and the cached
  // lookup usually resolves instantly, so neither should wait on the other.
  const [embedding, siteWords] = await Promise.all([
    embedText(query, "query"),
    agentSiteWords(agentId),
  ]);
  const queryTerms = retrievalQueryTerms(query, { siteWords });
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
      titlePrecision: titlePrecision(row.title, queryTerms),
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
        titlePrecision: titlePrecision(row.title, queryTerms),
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
        titlePrecision: titlePrecision(row.title, queryTerms),
        rankScore: 0,
      });
    }
  });

  // Identical text wins identical scores, so duplicates arrive adjacent and
  // each one displaces a different page from the evidence the model reads.
  // Deduplicate on content rather than chunk id: the copies are separate rows.
  const byContent = new Map<string, RetrievalHit>();
  for (const hit of combined.values()) {
    const key = `${hit.documentId}:${hit.content.replace(/\s+/g, " ").trim()}`;
    const existing = byContent.get(key);
    if (!existing || hit.score > existing.score) byContent.set(key, hit);
  }

  return [...byContent.values()]
    .map((hit) => {
      hit.rankScore =
        hit.vectorScore * 0.45 +
        Math.max(-1, Math.min(hit.keywordScore, 1)) * 0.35 +
        hit.lexicalScore * 0.25 +
        hit.titleScore * 0.9 +
        // Without this, "Time Calculator" and "Screen Time Calculator" are
        // indistinguishable for the query "time calculator", and whichever
        // page is longer wins on cover density instead.
        hit.titlePrecision * 0.35 +
        (hit.position === 0 && hit.keywordScore > 0 ? 0.05 : 0);
      return hit;
    })
    .sort(
      (a, b) => b.rankScore - a.rankScore || b.score - a.score,
    )
    .slice(0, limit);
}
