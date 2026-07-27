import {
  and,
  cosineDistance,
  desc,
  eq,
  isNotNull,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chunks, documents } from "@/lib/db/schema";
import { embedText } from "./embeddings";

export type RetrievalHit = {
  chunkId: string;
  content: string;
  title: string;
  url?: string;
  vectorScore: number;
  keywordScore: number;
  score: number;
  position: number;
  lexicalScore: number;
};

export async function hybridRetrieve(
  agentId: string,
  query: string,
  limit = 6,
): Promise<RetrievalHit[]> {
  const embedding = await embedText(query);
  const queryTerms = [
    ...new Set(
      (query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
        (term) =>
          !["the", "and", "what", "where", "when", "which", "with", "from", "this", "that", "your", "how"].includes(term),
      ),
    ),
  ];
  const lexicalScore = (content: string) => {
    const lower = content.toLowerCase();
    return queryTerms.length
      ? queryTerms.filter((term) => lower.includes(term)).length /
          queryTerms.length
      : 0;
  };
  const vectorSimilarity =
    sql<number>`1 - (${cosineDistance(chunks.embedding, embedding)})`;
  const keywordRank = sql<number>`
    ts_rank_cd(
      to_tsvector('english', ${chunks.content}),
      websearch_to_tsquery('english', ${query})
    )
    + case when ${chunks.position} = 0 then 0.35 else 0 end
    - case
        when ${chunks.content} ~* '(isbn|retrieved [0-9]|archived from|bibliography|references)'
        then 2.0
        else 0
      end
  `;

  const [vectorRows, keywordRows] = await Promise.all([
    db
      .select({
        chunkId: chunks.id,
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
      .limit(20),
    db
      .select({
        chunkId: chunks.id,
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
          sql`to_tsvector('english', ${chunks.content}) @@ websearch_to_tsquery('english', ${query})`,
        ),
      )
      .orderBy(desc(keywordRank))
      .limit(20),
  ]);

  const combined = new Map<string, RetrievalHit>();
  vectorRows.forEach((row, index) => {
    combined.set(row.chunkId, {
      chunkId: row.chunkId,
      content: row.content,
      title: row.title,
      url: row.url ?? undefined,
      vectorScore: Number(row.score ?? 0),
      keywordScore: 0,
      score: 1 / (60 + index + 1),
      position: row.position,
      lexicalScore: lexicalScore(row.content),
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
        content: row.content,
        title: row.title,
        url: row.url ?? undefined,
        vectorScore: 0,
        keywordScore: Number(row.score ?? 0),
        score: 1 / (60 + index + 1),
        position: row.position,
        lexicalScore: lexicalScore(row.content),
      });
    }
  });

  return [...combined.values()]
    .sort((a, b) => {
      const aQuality =
        a.vectorScore * 0.5 +
        Math.max(-1, Math.min(a.keywordScore, 1)) * 0.35 +
        a.lexicalScore * 0.2 +
        (a.position === 0 && a.keywordScore > 0 ? 0.65 : 0);
      const bQuality =
        b.vectorScore * 0.5 +
        Math.max(-1, Math.min(b.keywordScore, 1)) * 0.35 +
        b.lexicalScore * 0.2 +
        (b.position === 0 && b.keywordScore > 0 ? 0.65 : 0);
      return bQuality - aQuality || b.score - a.score;
    })
    .slice(0, limit);
}
