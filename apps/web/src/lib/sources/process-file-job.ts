import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
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
import { chunkText } from "@/lib/rag/chunk";
import { htmlToText } from "./html-text";
import { embedTexts } from "@/lib/rag/embeddings";
import { extractPdfPages } from "./ingest-pdf";
import { parseCsvRecords } from "./ingest-csv";
import { extractSpreadsheetRecords } from "./ingest-spreadsheet";
import type { SourceRecord } from "./ingest-records";
import type { StagedUpload } from "./upload-kinds";
import { discardStagedUpload, readStagedUpload } from "./upload-store";

const EMBEDDING_BATCH_SIZE = 16;
const PAGE_EVENT_FLUSH_SIZE = 10;

/** Records held before a batch is written. See `flushPending`. */
const RECORD_BATCH_SIZE = 25;

/** Progress is split by phase so a stall can be attributed to a stage. */
const PARSE_PROGRESS_CEILING = 25;
const EMBED_PROGRESS_CEILING = 92;

/** Records with less text than this carry no answerable content. */
const MIN_RECORD_CHARACTERS = 40;

/**
 * Turns a staged upload into records, one per natural unit of the format.
 *
 * Page and sheet level records keep citations meaningful and give the operator
 * something that visibly moves during a long parse, rather than one opaque
 * step that either finishes or does not.
 */
async function parseUpload(
  upload: StagedUpload,
  bytes: Uint8Array,
  onProgress: (parsed: number, total: number) => Promise<void>,
): Promise<SourceRecord[]> {
  if (upload.kind === "pdf") {
    const pages = await extractPdfPages(bytes);
    const records: SourceRecord[] = [];
    for (const [index, text] of pages.entries()) {
      if (text.length >= MIN_RECORD_CHARACTERS) {
        records.push({
          title: `${upload.fileName} - page ${index + 1}`,
          content: text,
          metadata: { page: index + 1, pages: pages.length },
        });
      }
      await onProgress(index + 1, pages.length);
    }
    return records;
  }

  if (upload.kind === "spreadsheet") {
    const records = await extractSpreadsheetRecords(bytes, upload.fileName);
    await onProgress(records.length, records.length);
    return records;
  }

  const text = new TextDecoder().decode(bytes).replace(/\0/g, "");
  if (upload.kind === "csv") {
    const records = parseCsvRecords(text, upload.fileName);
    await onProgress(records.length, records.length);
    return records;
  }

  const content = (upload.kind === "html" ? htmlToText(text) : text).trim();
  await onProgress(1, 1);
  return content.length >= MIN_RECORD_CHARACTERS
    ? [{ title: upload.fileName, content, metadata: {} }]
    : [];
}

export async function processFileJob(jobId: string, sourceId: string) {
  const [record] = await db
    .select({ source: sources, agent: agents })
    .from(sources)
    .innerJoin(agents, eq(agents.id, sources.agentId))
    .where(eq(sources.id, sourceId))
    .limit(1);

  const upload = record?.source.metadata?.upload as StagedUpload | undefined;
  if (!record || !upload?.storageKey) {
    throw new Error("Upload source was removed or has no staged file.");
  }

  await db
    .update(sources)
    .set({
      status: "indexing",
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(sources.id, sourceId));
  await db
    .update(agents)
    .set({ status: "training", updatedAt: new Date() })
    .where(eq(agents.id, record.agent.id));
  try {
    await db
      .delete(crawlPages)
      .where(and(eq(crawlPages.sourceId, sourceId), ne(crawlPages.jobId, jobId)));
  } catch (error) {
    logger.warn({ error, sourceId }, "Previous file events not cleared");
  }
  await db
    .update(crawlJobs)
    .set({ phase: "parsing", updatedAt: new Date() })
    .where(eq(crawlJobs.id, jobId));

  let eventBuffer: Array<typeof crawlPages.$inferInsert> = [];
  let sequence = 0;
  let failed = 0;
  let skipped = 0;
  const flushEvents = async (force = false) => {
    if (!eventBuffer.length) return;
    if (!force && eventBuffer.length < PAGE_EVENT_FLUSH_SIZE) return;
    const batch = eventBuffer;
    eventBuffer = [];
    try {
      // Upsert: one row per URL per job. A retry re-recording a URL replaces
      // its earlier row rather than adding a second one to be summed.
      await db
        .insert(crawlPages)
        .values(batch)
        .onConflictDoUpdate({
          target: [crawlPages.jobId, crawlPages.url],
          set: {
            sequence: sql`excluded.sequence`,
            outcome: sql`excluded.outcome`,
            title: sql`excluded.title`,
            reason: sql`excluded.reason`,
            chunkCount: sql`excluded.chunk_count`,
          },
        });
    } catch (error) {
      // Reporting only. A missing migration should cost the detail view, not
      // the indexing run.
      logger.warn({ error, jobId }, "File events could not be stored");
    }
  };
  const recordUnit = (event: {
    label: string;
    outcome: string;
    title?: string;
    reason?: string;
    chunkCount?: number;
  }) => {
    if (event.outcome === "failed") failed += 1;
    if (event.outcome === "duplicate" || event.outcome === "thin") skipped += 1;
    sequence += 1;
    eventBuffer.push({
      jobId,
      sourceId,
      sequence,
      url: event.label.slice(0, 2_000),
      outcome: event.outcome,
      title: event.title?.slice(0, 300) ?? null,
      reason: event.reason?.slice(0, 500) ?? null,
      chunkCount: event.chunkCount ?? 0,
    });
  };

  const bytes = await readStagedUpload(upload.storageKey);
  if (!bytes) {
    throw new Error("The staged upload is no longer available.");
  }

  await assertNotCancelled(jobId);
  const records = await parseUpload(
    upload,
    new Uint8Array(bytes),
    async (parsed, total) => {
      await assertNotCancelled(jobId);
      await db
        .update(crawlJobs)
        .set({
          phase: "parsing",
          pagesDiscovered: total,
          pagesProcessed: parsed,
          progress: Math.round(
            (parsed / Math.max(1, total)) * PARSE_PROGRESS_CEILING,
          ),
          updatedAt: new Date(),
        })
        .where(eq(crawlJobs.id, jobId));
    },
  );

  if (!records.length) {
    throw new Error(
      upload.kind === "pdf"
        ? "No selectable text was found. Scanned PDFs need OCR before they can be indexed."
        : "The file does not contain enough readable text.",
    );
  }

  // Content already indexed for this agent under a different source. Embedding
  // it again would spend the slowest part of the pipeline to make the same
  // passage compete with itself at retrieval time.
  const existingHashes = new Set(
    (
      await db
        .select({ contentHash: documents.contentHash })
        .from(documents)
        .innerJoin(sources, eq(sources.id, documents.sourceId))
        .where(
          and(
            eq(sources.agentId, record.agent.id),
            ne(documents.sourceId, sourceId),
          ),
        )
    ).map((row) => row.contentHash),
  );

  await db
    .update(crawlJobs)
    .set({ phase: "embedding", updatedAt: new Date() })
    .where(eq(crawlJobs.id, jobId));

  type PreparedRecord = {
    record: SourceRecord;
    contentHash: string;
    order: number;
    chunks: Array<{
      position: number;
      content: string;
      tokenCount: number;
      embedding: number[];
    }>;
  };

  /**
   * Records held before a batch is written. Same reasoning as the crawler:
   * accumulating every page of a large PDF and every vector it produces until
   * one closing transaction makes peak memory a function of the file rather
   * than of the batch, and a run that dies has nothing to show for itself.
   */
  let pending: PreparedRecord[] = [];
  let embedded = 0;
  let indexedChunks = 0;

  /** Commits one batch: documents and their chunks, in a single transaction. */
  const flushPending = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    await db.transaction(async (tx) => {
      for (const item of batch) {
        const [document] = await tx
          .insert(documents)
          .values({
            sourceId,
            runId: jobId,
            title: item.record.title,
            canonicalUrl: item.record.canonicalUrl,
            contentHash: item.contentHash,
            mimeType: upload.mimeType,
            characterCount: item.record.content.length,
            metadata: { ...item.record.metadata, uploadOrder: item.order },
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
              metadata: { title: item.record.title },
            })),
          );
        }
        indexedChunks += item.chunks.length;
      }
    });
  };

  // Records already written by an earlier attempt of this same job. Parsing is
  // deterministic - the same file yields the same records in the same order -
  // so the order recorded on each document identifies exactly what survived.
  const doneOrders = new Set(
    (
      await db
        .select({ metadata: documents.metadata })
        .from(documents)
        .where(
          and(eq(documents.sourceId, sourceId), eq(documents.runId, jobId)),
        )
    )
      .map((row) => Number(row.metadata?.uploadOrder))
      .filter((order) => Number.isInteger(order)),
  );
  if (doneOrders.size) {
    logger.info(
      { jobId, sourceId, resumed: doneOrders.size },
      "Resuming a file job that already indexed part of this file",
    );
    embedded = doneOrders.size;
  }

  for (const [index, item] of records.entries()) {
    await assertNotCancelled(jobId);
    if (doneOrders.has(index)) continue;
    const contentHash = createHash("sha256").update(item.content).digest("hex");
    if (existingHashes.has(contentHash)) {
      recordUnit({
        label: item.title,
        outcome: "duplicate",
        title: item.title,
        reason: "This content is already indexed from another upload.",
      });
      continue;
    }
    existingHashes.add(contentHash);

    const textChunks = chunkText(item.content);
    if (!textChunks.length) {
      recordUnit({
        label: item.title,
        outcome: "thin",
        title: item.title,
        reason: "Too little readable text to index.",
      });
      continue;
    }

    const embeddedChunks: PreparedRecord["chunks"] = [];
    for (
      let offset = 0;
      offset < textChunks.length;
      offset += EMBEDDING_BATCH_SIZE
    ) {
      const batch = textChunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const vectors = await embedTexts(batch.map((chunk) => chunk.content));
      embeddedChunks.push(
        ...batch.map((chunk, position) => ({
          ...chunk,
          embedding: vectors[position],
        })),
      );
    }
    pending.push({
      record: item,
      contentHash,
      order: index,
      chunks: embeddedChunks,
    });
    embedded += 1;
    if (pending.length >= RECORD_BATCH_SIZE) await flushPending();
    recordUnit({
      label: item.title,
      outcome: "indexed",
      title: item.title,
      chunkCount: embeddedChunks.length,
    });

    await flushEvents();
    await db
      .update(crawlJobs)
      .set({
        phase: "embedding",
        progress:
          PARSE_PROGRESS_CEILING +
          Math.round(
            ((index + 1) / records.length) *
              (EMBED_PROGRESS_CEILING - PARSE_PROGRESS_CEILING),
          ),
        pagesDiscovered: records.length,
        pagesProcessed: index + 1,
        pagesEmbedded: embedded,
        pagesSkipped: skipped,
        pagesFailed: failed,
        updatedAt: new Date(),
      })
      .where(eq(crawlJobs.id, jobId));
  }
  await flushEvents(true);
  await assertNotCancelled(jobId);

  await db
    .update(crawlJobs)
    .set({
      phase: "indexing",
      progress: EMBED_PROGRESS_CEILING,
      updatedAt: new Date(),
    })
    .where(eq(crawlJobs.id, jobId));

  await flushPending();
  // Counted rather than accumulated: a resumed run only adds the records it
  // wrote this time, so a running total would report the tail of the work as
  // though it were all of it.
  const [chunkTotal] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(chunks)
    .where(eq(chunks.sourceId, sourceId));
  indexedChunks = chunkTotal?.value ?? indexedChunks;

  await db.transaction(async (tx) => {
    // The sweep. New records were written in batches as they were embedded and
    // carry this job's id; anything still holding an older one belongs to the
    // previous version of this file. Deleting it here keeps the guarantee the
    // single closing transaction used to provide - the old version stays
    // searchable until the new one is complete - without holding the whole
    // file in memory to get it.
    const stale = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.sourceId, sourceId),
          or(isNull(documents.runId), ne(documents.runId, jobId)),
        ),
      );
    const staleIds = stale.map((row) => row.id);
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
        metadata: {
          ...(record.source.metadata ?? {}),
          records: embedded,
          chunks: indexedChunks,
          duplicates: skipped,
        },
        updatedAt: new Date(),
      })
      .where(eq(sources.id, sourceId));
    await tx
      .update(agents)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(agents.id, record.agent.id));
    await tx
      .update(crawlJobs)
      .set({
        status: "succeeded",
        phase: "done",
        progress: 100,
        pagesDiscovered: records.length,
        pagesProcessed: records.length,
        pagesEmbedded: embedded,
        pagesSkipped: skipped,
        pagesFailed: failed,
        chunksIndexed: indexedChunks,
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(crawlJobs.id, jobId));
  });

  // The staged copy exists only to hand bytes to the worker.
  await discardStagedUpload(upload.storageKey);
  return { records: embedded, chunks: indexedChunks, skipped };
}
