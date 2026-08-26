import { and, eq, inArray, sql } from "drizzle-orm";
import {
  crawlWebsite,
  discoverSiteUrls,
  type CrawlPageEvent,
} from "@/lib/crawl/crawler";
import { wasFetched } from "@/lib/crawl/outcomes";
import { db } from "@/lib/db/client";
import {
  agents,
  chunks,
  crawlJobs,
  crawlPages,
  documents,
  sources,
} from "@/lib/db/schema";
import { assertNotCancelled } from "@/lib/jobs/cancellation";
import { logger } from "@/lib/observability/logger";
import { recordSystemLog } from "@/lib/observability/system-log";
import { chunkText } from "@/lib/rag/chunk";
import { embedTexts } from "@/lib/rag/embeddings";

const EMBEDDING_BATCH_SIZE = 16;

/**
 * Pages held before a batch is written.
 *
 * This is the memory control, and a page limit is not one: a thousand short
 * pages and a thousand long ones cost very different amounts to hold. Smaller
 * batches mean lower peak memory and less work lost to a crash, at the cost of
 * more transactions.
 */
function crawlBatchPages() {
  const configured = Number(process.env.CRAWL_BATCH_PAGES?.trim());
  if (!Number.isFinite(configured) || configured < 1) return 25;
  return Math.min(500, Math.floor(configured));
}

/**
 * Page events are written in batches: one insert per URL would add thousands of
 * round trips to a large crawl purely for reporting. Kept small so the live
 * view in the dashboard stays close to what the crawler is actually doing.
 */
const PAGE_EVENT_FLUSH_SIZE = 10;

/** Progress is split by phase so a stall can be attributed to a stage. */
/** Discovery owns the first slice of the bar; it is quick but not instant. */
const DISCOVERY_PROGRESS_CEILING = 12;
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

  // ---- Phase one: find out what the site has ---------------------------
  //
  // Deliberately separate from fetching, and it ends by stopping. Discovery
  // costs seconds where indexing costs hours, so this is the only point at
  // which excluding a page is free - and it is the only point at which the
  // total is a fixed number rather than one climbing while it is read.
  const [jobRow] = await db
    .select({
      discoveredAt: crawlJobs.discoveredAt,
      autoApprove: crawlJobs.autoApprove,
    })
    .from(crawlJobs)
    .where(eq(crawlJobs.id, jobId))
    .limit(1);

  if (jobRow && !jobRow.discoveredAt) {
    await db
      .update(crawlJobs)
      .set({ phase: "discovering", progress: 1, updatedAt: new Date() })
      .where(eq(crawlJobs.id, jobId));

    const found = await discoverSiteUrls({
      url: record.source.rootUrl,
      pageLimit: record.source.pageLimit,
      includePaths: record.source.includePaths,
      excludePaths: record.source.excludePaths,
      sitemapUrl: record.source.sitemapUrl,
      trustedInternal:
        process.env.NODE_ENV !== "production" &&
        record.source.metadata?.managedBy === "docent-homepage" &&
        record.source.metadata?.trustedInternal === true,
      onProgress: async ({ discovered }) => {
        await assertNotCancelled(jobId);
        await db
          .update(crawlJobs)
          .set({
            pagesDiscovered: discovered,
            progress: Math.min(DISCOVERY_PROGRESS_CEILING, 1 + Math.round(discovered / 200)),
            updatedAt: new Date(),
          })
          .where(eq(crawlJobs.id, jobId));
      },
    });

    // Recorded, not selected. `selected` is absent from the update list so a
    // URL the operator already turned off stays off through re-discovery, and
    // `outcome` is only set on insert so a page that was indexed last run does
    // not have that overwritten with "discovered".
    for (let offset = 0; offset < found.urls.length; offset += 500) {
      // Deduplicated after truncation, not before. Discovery hands back a set,
      // so these are distinct URLs - but they are cut to 2,000 characters on
      // the way in, and two long URLs that differ only past that point become
      // the same row. Postgres refuses the whole statement when an ON CONFLICT
      // DO UPDATE would touch a row twice, so the cost of that collision is not
      // one lost URL, it is this entire batch of 500.
      const batch = Array.from(
        new Map(
          found.urls.slice(offset, offset + 500).map((url, index) => {
            const trimmed = url.slice(0, 2_000);
            return [
              trimmed,
              {
                jobId,
                sourceId,
                url: trimmed,
                sequence: offset + index,
                outcome: "discovered",
                lastSeenAt: new Date(),
              },
            ] as const;
          }),
        ).values(),
      );
      if (!batch.length) continue;
      await db
        .insert(crawlPages)
        .values(batch)
        .onConflictDoUpdate({
          target: [crawlPages.sourceId, crawlPages.url],
          set: { lastSeenAt: sql`excluded.last_seen_at` },
        });
    }

    await db
      .update(crawlJobs)
      .set({
        discoveredAt: new Date(),
        pagesDiscovered: found.urls.length,
        updatedAt: new Date(),
      })
      .where(eq(crawlJobs.id, jobId));

    // Recorded on the source, not only in a log, because the operator is the
    // one who can act on it: a site whose sitemap could not be read is a site
    // where supplying one, or lifting a firewall rule for a minute, turns a
    // long inferred crawl into a short exact one. They cannot decide that
    // without being told which happened.
    await db
      .update(sources)
      .set({
        metadata: {
          ...(record.source.metadata ?? {}),
          discovery: {
            method: found.method,
            sitemapUrl: found.sitemapUrl,
            declaredSitemaps: found.declaredSitemaps,
            urls: found.urls.length,
            truncated: found.truncated,
            at: new Date().toISOString(),
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(sources.id, sourceId));

    logger.info(
      {
        jobId,
        sourceId,
        urls: found.urls.length,
        method: found.method,
        sitemapUrl: found.sitemapUrl,
        truncated: found.truncated,
        autoApprove: jobRow.autoApprove,
      },
      "Crawl discovery finished",
    );

    if (!jobRow.autoApprove) {
      // Stop here and hand the job back to the queue in a state that says why.
      // Not `running`, because nothing is running; not `failed`, because
      // nothing went wrong.
      await db.transaction(async (tx) => {
        await tx
          .update(crawlJobs)
          .set({
            status: "awaiting_review",
            phase: "discovering",
            progress: DISCOVERY_PROGRESS_CEILING,
            lockedAt: null,
            lockedBy: null,
            finishedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(crawlJobs.id, jobId));
        await tx
          .update(sources)
          .set({ status: "pending", updatedAt: new Date() })
          .where(eq(sources.id, sourceId));
      });
      return;
    }
  }

  // The page list is no longer cleared here. It is an inventory of the URLs
  // this source holds, keyed by URL, and a crawl updates it in place - so an
  // operator can open a source a month later and see what is in it, and a
  // decision to exclude a page survives the next run. The old code deleted
  // every row from previous jobs, which is why neither was possible.
  await db
    .update(crawlJobs)
    .set({ phase: "crawling", updatedAt: new Date() })
    .where(eq(crawlJobs.id, jobId));

  // The inventory as it stood before this run, which is three things at once:
  // the operator's exclusions, the URLs this run has already finished (so a
  // resumed job does not fetch them twice), and last run's discovered frontier
  // to seed the queue with.
  const inventory = await db
    .select({
      url: crawlPages.url,
      selected: crawlPages.selected,
      jobId: crawlPages.jobId,
      outcome: crawlPages.outcome,
    })
    .from(crawlPages)
    .where(eq(crawlPages.sourceId, sourceId));
  const blockedUrls = new Set(
    inventory.filter((row) => !row.selected).map((row) => row.url),
  );
  // Fetched by an earlier attempt of *this* job. Skipping these is what makes a
  // restart resume rather than begin again; rows from previous runs are not
  // included, because their content may have changed since.
  //
  // "discovered" is excluded, and the distinction is load-bearing. Discovery
  // writes a row for every URL it finds, stamped with this same job id, and
  // those rows record that a URL exists - not that it has been read. Counting
  // them as fetched made an approved crawl skip its entire list and fail with
  // "no useful public text", because every page it meant to fetch looked like
  // one it had already done.
  const fetchedThisRun = new Set(
    inventory
      .filter((row) => row.jobId === jobId && wasFetched(row.outcome))
      .map((row) => row.url),
  );
  // Everything known, minus what the operator excluded. Feeding these back in
  // means a resumed crawl does not have to rediscover the site by following
  // links from the root all over again.
  const seedUrls = inventory
    .filter((row) => row.selected && !fetchedThisRun.has(row.url))
    .map((row) => row.url);
  if (fetchedThisRun.size || blockedUrls.size) {
    logger.info(
      {
        jobId,
        sourceId,
        alreadyFetched: fetchedThisRun.size,
        excluded: blockedUrls.size,
        seeded: seedUrls.length,
      },
      "Resuming crawl from the saved page inventory",
    );
  }

  // Buffered so a 7,000-page crawl does not pay a round trip per URL.
  let pageEventBuffer: Array<typeof crawlPages.$inferInsert> = [];
  let failedPages = 0;
  let pageSequence = 0;
  const flushPageEvents = async (force = false) => {
    if (!pageEventBuffer.length) return;
    if (!force && pageEventBuffer.length < PAGE_EVENT_FLUSH_SIZE) return;
    // One row per URL, keeping the last state recorded for it.
    //
    // Postgres refuses an ON CONFLICT DO UPDATE whose statement would touch the
    // same row twice - "cannot affect row a second time" - and it refuses the
    // whole statement, not the offending row. So a single URL appearing twice
    // in one flush window threw, the catch below swallowed it, and every page
    // event in that batch vanished with nothing on screen to say so. A URL
    // reported under two outcomes in the same window is ordinary: a redirect
    // followed by the indexing of where it landed does exactly that.
    //
    // A Map keeps the last value written for a key, which is the state we want.
    const batch = Array.from(
      new Map(pageEventBuffer.map((row) => [row.url, row])).values(),
    );
    pageEventBuffer = [];
    try {
      // Upsert on the URL. One row per URL per source, so a re-crawl updates
      // the row it already has rather than appending a second one to be summed.
      //
      // `selected` is deliberately absent from the update list: it belongs to
      // the operator, not to the crawl, and a re-crawl must not undo an
      // exclusion. `firstSeenAt` is likewise left alone so it keeps meaning
      // "first seen", not "seen most recently".
      await db
        .insert(crawlPages)
        .values(batch)
        .onConflictDoUpdate({
          target: [crawlPages.sourceId, crawlPages.url],
          set: {
            jobId: sql`excluded.job_id`,
            sequence: sql`excluded.sequence`,
            outcome: sql`excluded.outcome`,
            title: sql`excluded.title`,
            reason: sql`excluded.reason`,
            chunkCount: sql`excluded.chunk_count`,
            lastSeenAt: sql`excluded.last_seen_at`,
          },
        });
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
      lastSeenAt: new Date(),
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
    // The approved list, and only it. Discovery has already written every URL
    // it found into the inventory, so what survives `selected` here is exactly
    // what someone agreed to index.
    seedUrls,
    skipUrls: fetchedThisRun,
    blockedUrls,
    // Links found now are recorded for the next review rather than crawled.
    // Following them would mean indexing pages nobody approved, and would make
    // the total climb while it is being watched - the thing the review step
    // exists to prevent.
    followLinks: false,
    renderJs: (record.source.renderJs ?? "auto") as
      | "auto"
      | "always"
      | "never",
    onPage: recordPage,
    onProgress: async ({ discovered, processed }) => {
      // Throwing here unwinds out of the crawler, which is the earliest a stop
      // can take effect: the fetch loop has no other checkpoint.
      await assertNotCancelled(jobId);
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

  // Pages the site has grown since the list was approved. Written as
  // "discovered" and left unselected-by-default only in the sense that they are
  // new: the next review shows them, and nothing indexes them until then. This
  // is why the count on screen can stay still without the site quietly drifting
  // out of date.
  if (result.newUrls.length) {
    for (let offset = 0; offset < result.newUrls.length; offset += 500) {
      const batch = result.newUrls
        .slice(offset, offset + 500)
        .map((url, index) => ({
          jobId,
          sourceId,
          url: url.slice(0, 2_000),
          sequence: offset + index,
          // "suggested", not "discovered". A discovered URL came from the site's
          // own sitemap or from the list someone approved; a suggested one is
          // something the crawler noticed in passing and nobody has ever looked
          // at. Keeping them apart is what stops a reviewed list quietly
          // filling with pages the operator never chose.
          outcome: "suggested",
          // Off by default, and deliberately. These are unreviewed guesses -
          // pagination, tag archives, whatever a template happened to link -
          // and indexing them without being asked is how a clean corpus turns
          // into a noisy one. Ignoring this list has no effect on the agent.
          selected: false,
          lastSeenAt: new Date(),
        }));
      await db
        .insert(crawlPages)
        .values(batch)
        .onConflictDoNothing({
          target: [crawlPages.sourceId, crawlPages.url],
        });
    }
    logger.info(
      { jobId, sourceId, newUrls: result.newUrls.length },
      "New URLs recorded for the next review",
    );
  }

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
  //
  // `runId` says which attempt last touched each row. Rows already carrying
  // this job's id were written by an earlier attempt of this same job, so a
  // resumed run skips them: that set is the checkpoint.
  const existingDocuments = await db
    .select({
      id: documents.id,
      canonicalUrl: documents.canonicalUrl,
      contentHash: documents.contentHash,
      runId: documents.runId,
    })
    .from(documents)
    .where(eq(documents.sourceId, sourceId));
  const existingByUrl = new Map(
    existingDocuments.map((item) => [item.canonicalUrl, item]),
  );
  const alreadyThisRun = new Set(
    existingDocuments
      .filter((item) => item.runId === jobId && item.canonicalUrl)
      .map((item) => item.canonicalUrl as string),
  );
  if (alreadyThisRun.size) {
    logger.info(
      { jobId, sourceId, resumed: alreadyThisRun.size },
      "Resuming a crawl that already indexed part of this site",
    );
  }

  type PreparedPage = {
    page: (typeof result.pages)[number];
    crawlOrder: number;
    chunks: Array<{
      position: number;
      content: string;
      tokenCount: number;
      embedding: number[];
    }>;
  };

  /**
   * Pages held in memory before being written.
   *
   * This buffer is the memory ceiling. It used to be the whole site: every
   * page and every embedding accumulated until one closing transaction, so a
   * few thousand pages meant hundreds of megabytes of vectors and the run died
   * on a constrained host before it could write anything at all. Peak memory
   * is now a function of the batch, not of the site.
   */
  let pending: PreparedPage[] = [];
  /** Documents kept as-is because their content is byte-identical. */
  const reusedDocumentIds = new Set<string>();
  const crawledUrls = new Set<string>();
  let embeddedPages = 0;
  let reusedChunkCount = 0;
  let indexedChunks = 0;

  /**
   * Commits one batch: the documents and their chunks, together.
   *
   * Together is the whole point. A document written without its chunks is an
   * indexed page that can never be retrieved, and it is exactly what a crash
   * between two transactions would leave behind. Inside one transaction
   * Postgres guarantees the batch lands whole or not at all, so a resumed run
   * never has to reason about how much of a page survived - a page is either
   * there with its chunks or absent, and absent means redo it.
   */
  const flushPending = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    await db.transaction(async (tx) => {
      for (const item of batch) {
        // The unique index on (source, url) means the previous version has to
        // go before the new one lands. Chunks cascade with it.
        await tx
          .delete(documents)
          .where(
            and(
              eq(documents.sourceId, sourceId),
              eq(documents.canonicalUrl, item.page.url),
            ),
          );
        const [document] = await tx
          .insert(documents)
          .values({
            sourceId,
            runId: jobId,
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
              metadata: { url: item.page.url, title: item.page.title },
            })),
          );
        }
        indexedChunks += item.chunks.length;
      }
    });
  };

  for (let pageIndex = 0; pageIndex < result.pages.length; pageIndex += 1) {
    const page = result.pages[pageIndex];
    crawledUrls.add(page.url);

    // Written by an earlier attempt of this same job. Its chunks are already
    // in place, so re-embedding it would spend the slowest part of the run
    // reproducing work that survived the crash.
    if (alreadyThisRun.has(page.url)) {
      const prior = existingByUrl.get(page.url);
      if (prior) reusedDocumentIds.add(prior.id);
      continue;
    }

    const prior = existingByUrl.get(page.url);

    if (prior && prior.contentHash === page.contentHash) {
      reusedDocumentIds.add(prior.id);
      const [reused] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(chunks)
        .where(eq(chunks.documentId, prior.id));
      reusedChunkCount += reused?.value ?? 0;
      // Claim it for this run so the closing sweep, which removes anything not
      // carrying this job's id, does not delete a page that is still correct.
      await db
        .update(documents)
        .set({ runId: jobId })
        .where(eq(documents.id, prior.id));
      recordPage({
        url: page.url,
        outcome: "unchanged",
        title: page.title,
        reason: "Content is unchanged since the last run, so it was reused.",
      });
      continue;
    }

    await assertNotCancelled(jobId);
    const textChunks = chunkText(page.text);
    const embeddedChunks: PreparedPage["chunks"] = [];

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
    pending.push({ page, crawlOrder: pageIndex, chunks: embeddedChunks });
    embeddedPages += 1;
    if (pending.length >= crawlBatchPages()) await flushPending();

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

  // Everything embedded so far is already durable; this only commits the tail
  // of the last batch.
  await assertNotCancelled(jobId);
  await flushPending();
  // Counted rather than accumulated. Reused pages keep chunks this run never
  // wrote, and a resumed run inherits whatever an earlier attempt committed;
  // only the table knows the real total.
  const [chunkTotal] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(chunks)
    .where(eq(chunks.sourceId, sourceId));
  indexedChunks = chunkTotal?.value ?? indexedChunks + reusedChunkCount;

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
    // The sweep. Pages were replaced one batch at a time as they were crawled,
    // so what is left carrying an older run id is what this crawl did not find
    // at all: pages removed from the site since the last run.
    //
    // The guarantee the old single closing transaction provided is kept, by a
    // different route. Each URL only ever held its previous version or its new
    // one, never neither, so a run that dies leaves a coherent index rather
    // than an erased source - and now it leaves the finished part of its work
    // behind too.
    const staleIds = existingDocuments
      .filter(
        (item) =>
          !reusedDocumentIds.has(item.id) && !crawledUrls.has(item.canonicalUrl ?? ""),
      )
      .map((item) => item.id);
    for (let offset = 0; offset < staleIds.length; offset += 500) {
      await tx
        .delete(documents)
        .where(inArray(documents.id, staleIds.slice(offset, offset + 500)));
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
        // "Some of it" is not "all of it". A run the circuit breaker ended, or
        // one that could never read a page well enough to identify the site,
        // is reported as partial so the operator can decide whether to retry.
        status: result.stoppedEarly || !result.brandDetected
          ? "partial"
          : "succeeded",
        errorCode: result.stoppedEarly
          ? "CRAWL_STOPPED_EARLY"
          : !result.brandDetected
            ? "CRAWL_BRAND_UNKNOWN"
            : null,
        errorMessage: result.stoppedEarly
          ? `The site stopped responding after ${result.failures.length} failed requests, so ${result.pages.length} pages were indexed and the rest were not reached. Retrying with a lower CRAWL_CONCURRENCY often helps.`
          : !result.brandDetected
            ? "No page could be read well enough to detect the site name, logo or colours. The defaults were used."
            : null,
        phase: "done",
        progress: 100,
        // The same meaning it carried throughout the run: URLs found and
        // tried. It used to be rewritten here as pages-kept-plus-failures, so
        // the number the operator had been watching dropped at the finish line
        // and looked like pages had been lost.
        pagesDiscovered: result.discovered,
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
