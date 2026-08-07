import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { crawlWebsite, type CrawlPageEvent } from "@/lib/crawl/crawler";
import { db } from "@/lib/db/client";
import {
  agents,
  chunks,
  crawlJobs,
  crawlPages,
  documents,
  sources,
} from "@/lib/db/schema";
import { logger } from "@/lib/observability/logger";
import { recordSystemLog } from "@/lib/observability/system-log";
import { chunkText } from "@/lib/rag/chunk";
import { embedTexts } from "@/lib/rag/embeddings";

const EMBEDDING_BATCH_SIZE = 16;

/**
 * Page events are written in batches: one insert per URL would add thousands of
 * round trips to a large crawl purely for reporting. Kept small so the live
 * view in the dashboard stays close to what the crawler is actually doing.
 */
const PAGE_EVENT_FLUSH_SIZE = 10;

/** Progress is split by phase so a stall can be attributed to a stage. */
const CRAWL_PROGRESS_CEILING = 60;
const EMBED_PROGRESS_CEILING = 92;

/**
 * Everything that can happen to a URL during indexing. The crawler reports how
 * fetching went; `unchanged` is decided later, when the content hash turns out
 * to match what is already indexed.
 */
type IndexPageEvent =
  | CrawlPageEvent
  | {
      url: string;
      outcome: "unchanged";
      title?: string;
      reason?: string;
    };

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

  // Only the current run is useful, and retaining every run of a large site
  // would grow without bound.
  try {
    await db
      .delete(crawlPages)
      .where(and(eq(crawlPages.sourceId, sourceId), ne(crawlPages.jobId, jobId)));
  } catch (error) {
    logger.warn({ error, sourceId }, "Previous crawl page events not cleared");
  }
  await db
    .update(crawlJobs)
    .set({ phase: "crawling", updatedAt: new Date() })
    .where(eq(crawlJobs.id, jobId));

  // Buffered so a 7,000-page crawl does not pay a round trip per URL.
  let pageEventBuffer: Array<typeof crawlPages.$inferInsert> = [];
  let failedPages = 0;
  let pageSequence = 0;
  const flushPageEvents = async (force = false) => {
    if (!pageEventBuffer.length) return;
    if (!force && pageEventBuffer.length < PAGE_EVENT_FLUSH_SIZE) return;
    const batch = pageEventBuffer;
    pageEventBuffer = [];
    try {
      await db.insert(crawlPages).values(batch);
    } catch (error) {
      // Per-page reporting is diagnostics. If the table is missing because a
      // migration has not been applied, the crawl should still index the site
      // and lose only its progress detail.
      logger.warn(
        { error, jobId, pages: batch.length },
        "Crawl page events could not be stored",
      );
    }
  };
  const recordPage = (event: IndexPageEvent) => {
    if (event.outcome === "failed") failedPages += 1;
    pageSequence += 1;
    pageEventBuffer.push({
      jobId,
      sourceId,
      sequence: pageSequence,
      url: event.url.slice(0, 2_000),
      outcome: event.outcome,
      title: event.title?.slice(0, 300) ?? null,
      reason: event.reason?.slice(0, 500) ?? null,
    });
  };

  let crawlProgress = 0;
  const result = await crawlWebsite({
    url: record.source.rootUrl,
    pageLimit: record.source.pageLimit,
    includePaths: record.source.includePaths,
    excludePaths: record.source.excludePaths,
    trustedInternal:
      process.env.NODE_ENV !== "production" &&
      record.source.metadata?.managedBy === "docent-homepage" &&
      record.source.metadata?.trustedInternal === true,
    onPage: recordPage,
    onProgress: async ({ discovered, processed }) => {
      const crawlTarget = Math.max(
        1,
        Math.min(discovered, record.source.pageLimit),
      );
      crawlProgress = Math.max(
        crawlProgress,
        Math.min(
          CRAWL_PROGRESS_CEILING,
          Math.round(
            (Math.min(processed, crawlTarget) / crawlTarget) *
              CRAWL_PROGRESS_CEILING,
          ),
        ),
      );
      await flushPageEvents();
      await db
        .update(crawlJobs)
        .set({
          phase: "crawling",
          pagesDiscovered: discovered,
          pagesProcessed: processed,
          pagesFailed: failedPages,
          progress: crawlProgress,
          updatedAt: new Date(),
        })
        .where(eq(crawlJobs.id, jobId));
    },
  });
  await flushPageEvents(true);

  await db
    .update(sources)
    .set({ status: "indexing", updatedAt: new Date() })
    .where(eq(sources.id, sourceId));
  await db
    .update(crawlJobs)
    .set({ phase: "embedding", updatedAt: new Date() })
    .where(eq(crawlJobs.id, jobId));

  // Content hashes of what is already indexed. Re-embedding a page whose text
  // has not changed is the single largest waste in a refresh of a large site,
  // and embedding dominates the run time.
  const existingDocuments = await db
    .select({
      id: documents.id,
      canonicalUrl: documents.canonicalUrl,
      contentHash: documents.contentHash,
    })
    .from(documents)
    .where(eq(documents.sourceId, sourceId));
  const existingByUrl = new Map(
    existingDocuments.map((item) => [item.canonicalUrl, item]),
  );

  const prepared: Array<{
    page: (typeof result.pages)[number];
    crawlOrder: number;
    chunks: Array<{
      position: number;
      content: string;
      tokenCount: number;
      embedding: number[];
    }>;
  }> = [];
  /** Documents kept as-is because their content is byte-identical. */
  const reusedDocumentIds = new Set<string>();
  const crawledUrls = new Set<string>();
  let embeddedPages = 0;
  let reusedChunkCount = 0;

  for (let pageIndex = 0; pageIndex < result.pages.length; pageIndex += 1) {
    const page = result.pages[pageIndex];
    crawledUrls.add(page.url);
    const prior = existingByUrl.get(page.url);

    if (prior && prior.contentHash === page.contentHash) {
      reusedDocumentIds.add(prior.id);
      const [reused] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(chunks)
        .where(eq(chunks.documentId, prior.id));
      reusedChunkCount += reused?.value ?? 0;
      recordPage({
        url: page.url,
        outcome: "unchanged",
        title: page.title,
        reason: "Content is unchanged since the last run, so it was reused.",
      });
      continue;
    }

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
    prepared.push({ page, crawlOrder: pageIndex, chunks: embeddedChunks });
    embeddedPages += 1;

    await flushPageEvents();
    await db
      .update(crawlJobs)
      .set({
        phase: "embedding",
        progress:
          CRAWL_PROGRESS_CEILING +
          Math.round(
            ((pageIndex + 1) / result.pages.length) *
              (EMBED_PROGRESS_CEILING - CRAWL_PROGRESS_CEILING),
          ),
        pagesEmbedded: embeddedPages,
        pagesSkipped: reusedDocumentIds.size,
        pagesFailed: failedPages,
        updatedAt: new Date(),
      })
      .where(eq(crawlJobs.id, jobId));
  }
  await flushPageEvents(true);

  const indexedChunks =
    prepared.reduce((total, item) => total + item.chunks.length, 0) +
    reusedChunkCount;

  await db
    .update(crawlJobs)
    .set({
      phase: "indexing",
      progress: EMBED_PROGRESS_CEILING,
      pagesEmbedded: embeddedPages,
      pagesSkipped: reusedDocumentIds.size,
      pagesFailed: failedPages,
      updatedAt: new Date(),
    })
    .where(eq(crawlJobs.id, jobId));
  const managedHomepage =
    record.source.metadata?.managedBy === "docent-homepage";
  await db.transaction(async (tx) => {
    // The old searchable index remains live until all new embeddings exist.
    // Replacement then happens atomically, so a failed model download cannot
    // erase a previously healthy source.
    //
    // Only documents that changed or disappeared are removed. Reused documents
    // keep their existing chunks and embeddings untouched.
    const staleIds = existingDocuments
      .filter((item) => !reusedDocumentIds.has(item.id))
      .map((item) => item.id);
    for (let offset = 0; offset < staleIds.length; offset += 500) {
      await tx
        .delete(documents)
        .where(inArray(documents.id, staleIds.slice(offset, offset + 500)));
    }
    for (const item of prepared) {
      const [document] = await tx
        .insert(documents)
        .values({
          sourceId,
          canonicalUrl: item.page.url,
          title: item.page.title,
          contentHash: item.page.contentHash,
          characterCount: item.page.text.length,
          metadata: {
            description: item.page.description,
            publishedAt: item.page.publishedAt,
            crawlOrder: item.crawlOrder,
          },
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
          !managedHomepage &&
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
        phase: "done",
        progress: 100,
        pagesDiscovered: result.pages.length + result.failures.length,
        pagesProcessed: result.pages.length,
        pagesEmbedded: embeddedPages,
        pagesSkipped: reusedDocumentIds.size,
        pagesFailed: failedPages,
        chunksIndexed: indexedChunks,
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
      embedded: embeddedPages,
      reused: reusedDocumentIds.size,
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
