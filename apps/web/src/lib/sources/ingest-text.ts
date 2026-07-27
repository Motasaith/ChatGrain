import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, chunks, documents, sources } from "@/lib/db/schema";
import { chunkText } from "@/lib/rag/chunk";
import { embedTexts } from "@/lib/rag/embeddings";

export async function ingestTextSource({
  agentId,
  name,
  content,
  type = "text",
  mimeType = "text/plain",
}: {
  agentId: string;
  name: string;
  content: string;
  type?: "text" | "file";
  mimeType?: string;
}) {
  const textChunks = chunkText(content);
  const prepared: Array<{
    position: number;
    content: string;
    tokenCount: number;
    embedding: number[];
  }> = [];
  for (let offset = 0; offset < textChunks.length; offset += 16) {
    const batch = textChunks.slice(offset, offset + 16);
    const embeddings = await embedTexts(batch.map((item) => item.content));
    prepared.push(
      ...batch.map((item, index) => ({
        ...item,
        embedding: embeddings[index],
      })),
    );
  }
  return db.transaction(async (tx) => {
    const [source] = await tx
      .insert(sources)
      .values({
        agentId,
        type,
        status: "ready",
        name,
        pageLimit: 1,
        lastSyncedAt: new Date(),
        metadata: { chunks: prepared.length },
      })
      .returning();
    const [document] = await tx
      .insert(documents)
      .values({
        sourceId: source.id,
        title: name,
        contentHash: createHash("sha256").update(content).digest("hex"),
        mimeType,
        characterCount: content.length,
      })
      .returning();
    await tx.insert(chunks).values(
      prepared.map((item) => ({
        documentId: document.id,
        sourceId: source.id,
        agentId,
        position: item.position,
        content: item.content,
        tokenCount: item.tokenCount,
        embedding: item.embedding,
        metadata: { title: name },
      })),
    );
    await tx
      .update(agents)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(agents.id, agentId));
    return { source, document, chunkCount: prepared.length };
  });
}
