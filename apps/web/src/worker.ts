import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  lte,
  sql,
} from "drizzle-orm";
import { cleanupInactiveUsers } from "@/lib/admin/retention";
import { ensureHomepageAgent } from "@/lib/agents/homepage-agent";
import { processCrawlJob } from "@/lib/crawl/process-job";
import { db } from "@/lib/db/client";
import {
  agents,
  crawlJobs,
  documents,
  sources,
  systemState,
} from "@/lib/db/schema";
import { logger } from "@/lib/observability/logger";
import { JobCancelled } from "@/lib/jobs/cancellation";
import { processFileJob } from "@/lib/sources/process-file-job";
import { recordSystemLog } from "@/lib/observability/system-log";
import { captureWorkerException } from "@/lib/observability/worker-sentry";

const workerId = `worker_${randomUUID().slice(0, 8)}`;
const pollInterval = Number(process.env.WORKER_POLL_MS ?? 1_200);
const heartbeatInterval = Math.max(
  2_000,
  Number(process.env.WORKER_HEARTBEAT_MS ?? 5_000),
);
let stopping = false;
let lastRefreshScan = 0;
let lastRetentionScan = 0;

async function heartbeat() {
  const value = { workerId, pid: process.pid };
  // Two keys on purpose. The shared one answers "is anything processing jobs",
  // which is what the dashboard shows. The per-worker one answers "is the
  // process holding *this* job still alive", which the shared key cannot: any
  // second worker - a developer's machine pointed at the same database, say -
  // overwrites it, so a job orphaned by one worker looks healthy because
  // another is beating.
  for (const key of ["worker", `worker:${workerId}`]) {
    await db
      .insert(systemState)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemState.key,
        set: { value, updatedAt: new Date() },
      });
  }
}

async function scheduleRefreshes() {
  if (Date.now() - lastRefreshScan < 60_000) return;
  lastRefreshScan = Date.now();
  const due = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.status, "ready"),
        lte(sources.nextSyncAt, new Date()),
      ),
    )
    .limit(50);
  for (const source of due) {
    const [active] = await db
      .select({ id: crawlJobs.id })
      .from(crawlJobs)
      .where(
        and(
          eq(crawlJobs.sourceId, source.id),
          sql`${crawlJobs.status} in ('queued', 'running')`,
        ),
      )
      .limit(1);
    if (!active) {
      await db.insert(crawlJobs).values({ sourceId: source.id });
    }
  }
}

async function runRetentionCleanup() {
  const intervalHours = Math.max(
    1,
    Number(process.env.RETENTION_SCAN_INTERVAL_HOURS ?? 24),
  );
  const intervalMs = intervalHours * 60 * 60 * 1000;
  if (Date.now() - lastRetentionScan < intervalMs) return;
  lastRetentionScan = Date.now();
  await cleanupInactiveUsers();
}

async function recoverStaleJobs() {
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
  await db
    .update(crawlJobs)
    .set({
      status: "queued",
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: new Date(),
      errorCode: "STALE_JOB_RECOVERED",
      errorMessage: "The previous worker stopped before completing this job.",
      updatedAt: new Date(),
    })
    .where(
      and(eq(crawlJobs.status, "running"), lt(crawlJobs.lockedAt, staleBefore)),
    );
}

/**
 * Closes out jobs stopped while they were still waiting in the queue.
 *
 * Without this the worker claims them anyway, starts work, and only then hits
 * its first cancellation checkpoint - so a stop pressed on a queued job is not
 * honoured until every job ahead of it has finished, which for a slow embedding
 * run is many minutes of the dashboard showing "Stopping…".
 */
async function discardCancelledJobs() {
  const stopped = await db
    .update(crawlJobs)
    .set({
      status: "cancelled",
      errorCode: "CANCELLED",
      errorMessage: "Stopped before any data was indexed.",
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(crawlJobs.status, "queued"),
        isNotNull(crawlJobs.cancelRequestedAt),
      ),
    )
    .returning({ id: crawlJobs.id });
  if (stopped.length) {
    logger.info({ jobs: stopped.length }, "Discarded jobs stopped while queued");
  }
}

async function claimJob() {
  const candidates = await db
    .select()
    .from(crawlJobs)
    .where(
      and(
        eq(crawlJobs.status, "queued"),
        // A job flagged between this scan and the claim below still stops at
        // its first checkpoint; this only avoids starting one needlessly.
        isNull(crawlJobs.cancelRequestedAt),
        lte(crawlJobs.nextAttemptAt, new Date()),
      ),
    )
    .orderBy(desc(crawlJobs.priority), asc(crawlJobs.createdAt))
    .limit(1);
  const candidate = candidates[0];
  if (!candidate) return null;

  const claimed = await db
    .update(crawlJobs)
    .set({
      status: "running",
      attempt: candidate.attempt + 1,
      lockedAt: new Date(),
      lockedBy: workerId,
      startedAt: candidate.startedAt ?? new Date(),
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(crawlJobs.id, candidate.id),
        eq(crawlJobs.status, "queued"),
      ),
    )
    .returning();
  return claimed[0] ?? null;
}

/**
 * Sends a claimed job to the processor for its source type.
 *
 * Uploads and crawls share the queue, the locking, the retry policy and the
 * progress reporting, and differ only in how bytes become text.
 */
async function runJob(job: NonNullable<Awaited<ReturnType<typeof claimJob>>>) {
  const [source] = await db
    .select({ type: sources.type })
    .from(sources)
    .where(eq(sources.id, job.sourceId))
    .limit(1);
  if (source?.type === "file" || source?.type === "text") {
    await processFileJob(job.id, job.sourceId);
    return;
  }
  await processCrawlJob(job.id, job.sourceId);
}

/**
 * Unwinds a job the operator stopped.
 *
 * Nothing indexed is left behind, because both processors only write their
 * results in a single transaction at the very end. A run stopped before that
 * point has changed nothing, which is why stopping is safe to offer at all: a
 * source that has never finished is removed, and a re-run of an existing
 * source still has its previous index intact.
 */
async function finishCancelledJob(
  job: NonNullable<Awaited<ReturnType<typeof claimJob>>>,
) {
  await db.transaction(async (tx) => {
    await tx
      .update(crawlJobs)
      .set({
        status: "cancelled",
        errorCode: "CANCELLED",
        errorMessage: "Stopped before any data was indexed.",
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(crawlJobs.id, job.id));
    const [existing] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(documents)
      .where(eq(documents.sourceId, job.sourceId));
    const [source] = await tx
      .select({ agentId: sources.agentId })
      .from(sources)
      .where(eq(sources.id, job.sourceId))
      .limit(1);
    if (existing?.value) {
      // A refresh: the previous index was never touched, so the source is
      // still exactly as usable as it was before the run started.
      await tx
        .update(sources)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(sources.id, job.sourceId));
    } else {
      // A first run: there is nothing to fall back to, and an empty source
      // in the list is a promise the agent cannot keep.
      await tx.delete(sources).where(eq(sources.id, job.sourceId));
    }
    if (source) {
      const [remaining] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(sources)
        .where(
          and(eq(sources.agentId, source.agentId), eq(sources.status, "ready")),
        );
      await tx
        .update(agents)
        .set({
          status: remaining?.value ? "ready" : "draft",
          updatedAt: new Date(),
        })
        .where(eq(agents.id, source.agentId));
    }
  });
  logger.info({ jobId: job.id }, "Job cancelled by operator");
}

async function failJob(
  job: NonNullable<Awaited<ReturnType<typeof claimJob>>>,
  error: unknown,
) {
  const message =
    error instanceof Error ? error.message.slice(0, 2_000) : "Unknown error";
  const retry = job.attempt < job.maxAttempts;
  const nextAttempt = new Date(
    Date.now() + Math.min(60_000, 2 ** job.attempt * 2_000),
  );
  await db.transaction(async (tx) => {
    await tx
      .update(crawlJobs)
      .set({
        status: retry ? "queued" : "failed",
        errorCode: retry ? "RETRY_SCHEDULED" : "CRAWL_FAILED",
        errorMessage: message,
        nextAttemptAt: nextAttempt,
        lockedAt: null,
        lockedBy: null,
        finishedAt: retry ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(crawlJobs.id, job.id));
    await tx
      .update(sources)
      .set({
        status: retry ? "pending" : "error",
        errorCode: retry ? "RETRY_SCHEDULED" : "CRAWL_FAILED",
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, job.sourceId));
    if (!retry) {
      const [source] = await tx
        .select({ agentId: sources.agentId })
        .from(sources)
        .where(eq(sources.id, job.sourceId))
        .limit(1);
      if (source) {
        await tx
          .update(agents)
          .set({ status: "error", updatedAt: new Date() })
          .where(eq(agents.id, source.agentId));
      }
    }
  });
  logger.error(
    { error, jobId: job.id, retry, attempt: job.attempt },
    "Crawl job failed",
  );
  captureWorkerException(error, {
    jobId: job.id,
    sourceId: job.sourceId,
    retry,
    attempt: job.attempt,
  });
  await recordSystemLog("error", "Crawl job failed", {
    jobId: job.id,
    sourceId: job.sourceId,
    retry,
    attempt: job.attempt,
    error: message,
  });
}

async function run() {
  try {
    const homepageAgentId = await ensureHomepageAgent();
    if (homepageAgentId) {
      logger.info(
        { agentId: homepageAgentId },
        "Homepage support agent is configured",
      );
    }
  } catch (error) {
    logger.warn({ error }, "Homepage support agent setup failed");
    await recordSystemLog("warn", "Homepage support agent setup failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
  await recoverStaleJobs();
  logger.info({ workerId, pollInterval }, "ChatGrain worker started");
  await recordSystemLog("info", "ChatGrain worker started", {
    workerId,
    pollInterval,
  });
  await heartbeat();
  const heartbeatTimer = setInterval(() => {
    void heartbeat().catch((error) => {
      logger.warn({ error, workerId }, "Worker heartbeat failed");
      captureWorkerException(error, { workerId, operation: "heartbeat" });
    });
  }, heartbeatInterval);
  try {
    while (!stopping) {
      try {
        await scheduleRefreshes();
        await runRetentionCleanup();
        await discardCancelledJobs();
        const job = await claimJob();
        if (!job) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          continue;
        }
        try {
          await runJob(job);
        } catch (error) {
          // Stopping is an instruction, not a fault: it must not retry, and it
          // must not mark the agent broken.
          if (error instanceof JobCancelled) {
            await finishCancelledJob(job);
          } else {
            await failJob(job, error);
          }
        }
      } catch (error) {
        logger.error({ error }, "Worker poll failed");
        captureWorkerException(error, { workerId });
        await recordSystemLog("error", "Worker poll failed", {
          workerId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
  }
  logger.info({ workerId }, "ChatGrain worker stopped");
  await recordSystemLog("info", "ChatGrain worker stopped", { workerId });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

run().catch((error) => {
  logger.fatal({ error }, "Worker crashed");
  captureWorkerException(error, { workerId });
  process.exitCode = 1;
});
