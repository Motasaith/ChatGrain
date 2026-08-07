import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, chunks, documents, sources } from "@/lib/db/schema";
import { chunkText } from "@/lib/rag/chunk";
import { embedTexts } from "@/lib/rag/embeddings";

/** One indexable unit: a spreadsheet row, a PDF page, a CSV record. */
export type SourceRecord = {
  title: string;
  content: string;
  canonicalUrl?: string;
  metadata: Record<string, unknown>;
};

const EMBEDDING_BATCH_SIZE = 16;
const INSERT_BATCH_SIZE = 250;

/**
 * Chunks, embeds, and stores a set of records as a single file source.
 *
 * Shared by every file format so CSV, spreadsheets, and PDFs cannot drift
 * apart in how they are chunked, embedded, or written.
 */
export async function ingestSourceRecords({
  agentId,
  name,
  records,
  format,
  mimeType,
  metadata = {},
}: {
  agentId: string;
  name: string;
  records: SourceRecord[];
  format: string;
  mimeType: string;
  metadata?: Record<string, unknown>;
}) {
  if (!records.length) return null;

  const preparedDocuments = records.flatMap((record) => {
    const textChunks = chunkText(record.content);
    if (!textChunks.length) return [];
    return [{ id: crypto.randomUUID(), ...record, chunks: textChunks }];
  });
  if (!preparedDocuments.length) return null;

  const pendingChunks = preparedDocuments.flatMap((document) =>
    document.chunks.map((chunk) => ({ document, chunk })),
  );
  const embeddedChunks: Array<{
    documentId: string;
    position: number;
    content: string;
    tokenCount: number;
    embedding: number[];
    metadata: Record<string, unknown>;
  }> = [];

  for (
    let offset = 0;
    offset < pendingChunks.length;
    offset += EMBEDDING_BATCH_SIZE
  ) {
    const batch = pendingChunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const embeddings = await embedTexts(batch.map((item) => item.chunk.content));
    embeddedChunks.push(
      ...batch.map((item, index) => ({
        documentId: item.document.id,
        position: item.chunk.position,
        content: item.chunk.content,
        tokenCount: item.chunk.tokenCount,
        embedding: embeddings[index],
        metadata: {
          title: item.document.title,
          url: item.document.canonicalUrl,
          ...item.document.metadata,
        },
      })),
    );
  }

  return db.transaction(async (tx) => {
    const [source] = await tx
      .insert(sources)
      .values({
        agentId,
        type: "file",
        status: "ready",
        name,
        pageLimit: preparedDocuments.length,
        lastSyncedAt: new Date(),
        metadata: {
          ...metadata,
          documents: preparedDocuments.length,
          chunks: embeddedChunks.length,
          format,
        },
      })
      .returning();

    for (
      let offset = 0;
      offset < preparedDocuments.length;
      offset += INSERT_BATCH_SIZE
    ) {
      await tx.insert(documents).values(
        preparedDocuments
          .slice(offset, offset + INSERT_BATCH_SIZE)
          .map((document) => ({
            id: document.id,
            sourceId: source.id,
            canonicalUrl: document.canonicalUrl,
            title: document.title,
            contentHash: createHash("sha256")
              .update(document.content)
              .digest("hex"),
            mimeType,
            characterCount: document.content.length,
            metadata: document.metadata,
          })),
      );
    }
    for (
      let offset = 0;
      offset < embeddedChunks.length;
      offset += INSERT_BATCH_SIZE
    ) {
      await tx.insert(chunks).values(
        embeddedChunks.slice(offset, offset + INSERT_BATCH_SIZE).map((chunk) => ({
          ...chunk,
          sourceId: source.id,
          agentId,
        })),
      );
    }
    await tx
      .update(agents)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(agents.id, agentId));
    return {
      source,
      documentCount: preparedDocuments.length,
      chunkCount: embeddedChunks.length,
    };
  });
}
