import { and, eq } from "drizzle-orm";
import { crawlWebsite } from "@/lib/crawl/crawler";
import { db } from "@/lib/db/client";
import {
  agents,
  chunks,
  crawlJobs,
  documents,
  sources,
} from "@/lib/db/schema";
import { logger } from "@/lib/observability/logger";
import { recordSystemLog } from "@/lib/observability/system-log";
import { chunkText } from "@/lib/rag/chunk";
import { embedTexts } from "@/lib/rag/embeddings";

const EMBEDDING_BATCH_SIZE = 16;

export async function processCrawlJob(jobId: string, sourceId: string) {
  const [record] = await db
    .select({ source: sources, agent: agents })
    .from(sources)
    .innerJoin(agents, eq(agents.id, sources.agentId))
    .where(eq(sources.id, sourceId))
    .limit(1);

  if (!record || !record.source.rootUrl) {
    throw new Error("Crawl source was removed or has no URL.");
  }

  await db
    .update(sources)
    .set({
      status: "crawling",
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(sources.id, sourceId));
  await db
    .update(agents)
    .set({ status: "training", updatedAt: new Date() })
    .where(eq(agents.id, record.agent.id));

  let crawlProgress = 0;
  const result = await crawlWebsite({
    url: record.source.rootUrl,
    pageLimit: record.source.pageLimit,
    includePaths: record.source.includePaths,
    excludePaths: record.source.excludePaths,
    onProgress: async ({ discovered, processed }) => {
      const crawlTarget = Math.max(
        1,
        Math.min(discovered, record.source.pageLimit),
      );
      crawlProgress = Math.max(
        crawlProgress,
        Math.min(
          68,
          Math.round(
            (Math.min(processed, crawlTarget) / crawlTarget) * 68,
          ),
        ),
      );
      await db
        .update(crawlJobs)
        .set({
          pagesDiscovered: discovered,
          pagesProcessed: processed,
          progress: crawlProgress,
          updatedAt: new Date(),
        })
        .where(eq(crawlJobs.id, jobId));
    },
  });

  await db
    .update(sources)
    .set({ status: "indexing", updatedAt: new Date() })
    .where(eq(sources.id, sourceId));

  const prepared: Array<{
    page: (typeof result.pages)[number];
    chunks: Array<{
      position: number;
      content: string;
      tokenCount: number;
      embedding: number[];
    }>;
  }> = [];
  for (let pageIndex = 0; pageIndex < result.pages.length; pageIndex += 1) {
    const page = result.pages[pageIndex];
    const textChunks = chunkText(page.text);
    const embeddedChunks: (typeof prepared)[number]["chunks"] = [];

    for (
      let offset = 0;
      offset < textChunks.length;
      offset += EMBEDDING_BATCH_SIZE
    ) {
      const batch = textChunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const embeddings = await embedTexts(batch.map((item) => item.content));
      embeddedChunks.push(
        ...batch.map((item, index) => ({
          ...item,
          embedding: embeddings[index],
        })),
      );
    }
    prepared.push({ page, chunks: embeddedChunks });

    await db
      .update(crawlJobs)
      .set({
        progress: 68 + Math.round(((pageIndex + 1) / result.pages.length) * 20),
        updatedAt: new Date(),
      })
      .where(eq(crawlJobs.id, jobId));
  }

  const indexedChunks = prepared.reduce(
    (total, item) => total + item.chunks.length,
    0,
  );
  await db.transaction(async (tx) => {
    // The old searchable index remains live until all new embeddings exist.
    // Replacement then happens atomically, so a failed model download cannot
    // erase a previously healthy source.
    await tx.delete(documents).where(eq(documents.sourceId, sourceId));
    for (const item of prepared) {
      const [document] = await tx
        .insert(documents)
        .values({
          sourceId,
          canonicalUrl: item.page.url,
          title: item.page.title,
          contentHash: item.page.contentHash,
          characterCount: item.page.text.length,
          metadata: { description: item.page.description },
        })
        .returning();
      if (item.chunks.length) {
        await tx.insert(chunks).values(
          item.chunks.map((chunk) => ({
            documentId: document.id,
            sourceId,
            agentId: record.agent.id,
            position: chunk.position,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            embedding: chunk.embedding,
            metadata: {
              url: item.page.url,
              title: item.page.title,
            },
          })),
        );
      }
    }
    await tx
      .update(sources)
      .set({
        status: "ready",
        lastSyncedAt: new Date(),
        nextSyncAt: record.source.refreshIntervalHours
          ? new Date(
              Date.now() + record.source.refreshIntervalHours * 60 * 60 * 1000,
            )
          : null,
        metadata: {
          ...(record.source.metadata ?? {}),
          pages: result.pages.length,
          chunks: indexedChunks,
          failures: result.failures.slice(0, 100),
        },
        updatedAt: new Date(),
      })
      .where(eq(sources.id, sourceId));
    await tx
      .update(agents)
      .set({
        status: "ready",
        primaryColor:
          record.agent.primaryColor === "#177e51"
            ? result.brand.primaryColor
            : record.agent.primaryColor,
        logoUrl:
          record.agent.logoUrl ??
          result.brand.logoUrl ??
          result.brand.iconUrl,
        iconUrl: record.agent.iconUrl ?? result.brand.iconUrl,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, record.agent.id));
    await tx
      .update(crawlJobs)
      .set({
        status: "succeeded",
        progress: 100,
        pagesDiscovered: result.pages.length + result.failures.length,
        pagesProcessed: result.pages.length,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(crawlJobs.id, jobId), eq(crawlJobs.status, "running")),
      );
  });

  logger.info(
    {
      jobId,
      sourceId,
      agentId: record.agent.id,
      pages: result.pages.length,
      chunks: indexedChunks,
      failures: result.failures.length,
    },
    "Crawl job completed",
  );
  await recordSystemLog("info", "Crawl job completed", {
    jobId,
    sourceId,
    agentId: record.agent.id,
    pages: result.pages.length,
    chunks: indexedChunks,
    failures: result.failures.length,
  });
}
