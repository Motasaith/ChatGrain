import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  like,
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
import {
  JobCancelled,
  WorkerStopping,
  beginWorkerShutdown,
} from "@/lib/jobs/cancellation";
import {
  holderIsAlive,
  silentHolderGraceMs,
  staleScanMs,
  workerHeartbeatKey,
} from "@/lib/jobs/liveness";
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
let lastStaleScan = 0;

async function heartbeat() {
  // Resident set, not heap: the memory that kills this process lives outside
  // the JavaScript heap - the ONNX embedding model, and Chromium when a page
  // needs rendering - so heapUsed reads comfortable right up until the OS
  // intervenes.
  const memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const value = { workerId, pid: process.pid, memoryMb };
  // Two keys on purpose. The shared one answers "is anything processing jobs",
  // which is what the dashboard shows. The per-worker one answers "is the
  // process holding *this* job still alive", which the shared key cannot: any
  // second worker - a developer's machine pointed at the same database, say -
  // overwrites it, so a job orphaned by one worker looks healthy because
  // another is beating.
  for (const key of ["worker", workerHeartbeatKey(workerId)]) {
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

/**
 * Returns jobs abandoned by a worker that died holding them.
 *
 * Runs on a timer rather than only at startup, which is where it used to live.
 * That ordering had a hole: a worker restarted a few minutes after a crash
 * found the lock still younger than the stale window, requeued nothing, and
 * never looked again. The job stayed `running`, held by a process that no
 * longer existed, and no other worker could claim it - a permanent stall
 * indistinguishable from a slow crawl. Closing a laptop mid-crawl and
 * reopening it is enough to produce it.
 */
async function recoverStaleJobs() {
  if (Date.now() - lastStaleScan < staleScanMs) return;
  lastStaleScan = Date.now();
  const now = Date.now();
  // Joined to the holder's own heartbeat key rather than the shared one. The
  // shared key is overwritten by whichever worker beat last, so a job orphaned
  // by a dead worker looks perfectly healthy through it as long as some other
  // worker is alive - which is exactly the case this needs to detect.
  const rows = await db
    .select({ job: crawlJobs, beatAt: systemState.updatedAt })
    .from(crawlJobs)
    .leftJoin(
      systemState,
      sql`${systemState.key} = 'worker:' || ${crawlJobs.lockedBy}`,
    )
    .where(eq(crawlJobs.status, "running"))
    .limit(200);
  for (const { job, beatAt } of rows) {
    // Never reclaim our own. A long batch between checkpoints is not a death.
    if (job.lockedBy === workerId) continue;
    const abandoned = beatAt
      ? !holderIsAlive(now, beatAt)
      : !job.lockedAt || now - job.lockedAt.getTime() > silentHolderGraceMs;
    if (!abandoned) continue;
    await handBackJob(
      job,
      "STALE_JOB_RECOVERED",
      "The worker running this stopped responding, so the job was returned to the queue.",
    );
  }
}

/**
 * Returns a job to the queue after its worker stopped holding it.
 *
 * Used for both halves of the same event: our own process going down under a
 * signal, and another process that went down without getting the chance to.
 *
 * The count this spends is `recoveries`, not `attempt`. Charging a retry for
 * being restarted is what let three deploys quietly exhaust a job's budget and
 * bury a crawl that had never once failed - the job arrived at its last attempt
 * having never thrown. Restarts still have a ceiling, because a job that takes
 * the worker down with it every time would otherwise restart forever.
 */
async function handBackJob(
  job: typeof crawlJobs.$inferSelect,
  errorCode: string,
  errorMessage: string,
) {
  const recoveries = job.recoveries + 1;
  const exhausted = recoveries >= job.maxRecoveries;
  const message = exhausted
    ? `${errorMessage} This has now happened ${recoveries} times, so it will not be retried automatically.`
    : errorMessage;
  await db.transaction(async (tx) => {
    await tx
      .update(crawlJobs)
      .set({
        status: exhausted ? "failed" : "queued",
        recoveries,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: new Date(),
        finishedAt: exhausted ? new Date() : null,
        errorCode: exhausted ? "WORKER_LOST_REPEATEDLY" : errorCode,
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(crawlJobs.id, job.id));
    if (exhausted) {
      await markSourceBroken(tx, job.sourceId, "WORKER_LOST_REPEATEDLY", message);
    } else {
      // Left as "pending" rather than "error": nothing is wrong with the source,
      // its job is simply back in the queue.
      await tx
        .update(sources)
        .set({
          status: "pending",
          errorCode,
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(sources.id, job.sourceId));
    }
  });
  logger.warn(
    { jobId: job.id, recoveries, exhausted, previousHolder: job.lockedBy },
    exhausted ? "Job abandoned too many times" : "Job returned to the queue",
  );
  await recordSystemLog(exhausted ? "error" : "warn", message, {
    jobId: job.id,
    sourceId: job.sourceId,
    recoveries,
    maxRecoveries: job.maxRecoveries,
    previousHolder: job.lockedBy,
    workerId,
  });
}

/**
 * Marks a source, and the agent that owns it, as broken.
 *
 * Shared by the two ways a job can run out of road: failing on its own merits
 * and being abandoned once too often.
 */
async function markSourceBroken(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  sourceId: string,
  errorCode: string,
  errorMessage: string,
) {
  await tx
    .update(sources)
    .set({ status: "error", errorCode, errorMessage, updatedAt: new Date() })
    .where(eq(sources.id, sourceId));
  const [source] = await tx
    .select({ agentId: sources.agentId })
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);
  if (source) {
    await tx
      .update(agents)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(agents.id, source.agentId));
  }
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

/**
 * Says so, loudly, when another worker is already serving this database.
 *
 * Job claiming is atomic, so two workers never process the same job and nothing
 * is corrupted. What they do instead is confuse: a developer's machine pointed
 * at the deployed `DATABASE_URL` will claim production jobs, and closing the
 * laptop strands whatever it was holding until its heartbeat goes stale and
 * another worker reclaims it. That looks exactly like a broken deployment,
 * which is a bad thing to have to work out from the symptoms.
 *
 * A warning rather than a refusal: running several workers on purpose is a
 * reasonable thing to want, and this is not the place to decide it is not.
 */
async function warnAboutPeers() {
  const beats = await db
    .select({ key: systemState.key, updatedAt: systemState.updatedAt })
    .from(systemState)
    .where(like(systemState.key, "worker:%"));
  const peers = beats
    .filter(
      (beat) =>
        beat.key !== `worker:${workerId}` &&
        Date.now() - beat.updatedAt.getTime() < 60_000,
    )
    .map((beat) => beat.key.slice("worker:".length));
  if (!peers.length) return;
  logger.warn(
    { workerId, peers },
    "Another worker is already processing jobs on this database. " +
      "If this is a development machine, point DATABASE_URL at a local " +
      "database or start the web server on its own with `npm run dev:web`.",
  );
  await recordSystemLog("warn", "Multiple workers share this database", {
    workerId,
    peers,
  });
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
      // Claiming is deliberately not an attempt. `attempt` counts failures, and
      // it is incremented by the code that observes one; picking a job up says
      // nothing yet about whether it will fail.
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
  const attempt = job.attempt + 1;
  const retry = attempt < job.maxAttempts;
  const nextAttempt = new Date(
    Date.now() + Math.min(60_000, 2 ** attempt * 2_000),
  );
  await db.transaction(async (tx) => {
    await tx
      .update(crawlJobs)
      .set({
        status: retry ? "queued" : "failed",
        attempt,
        errorCode: retry ? "RETRY_SCHEDULED" : "CRAWL_FAILED",
        errorMessage: message,
        nextAttemptAt: nextAttempt,
        lockedAt: null,
        lockedBy: null,
        finishedAt: retry ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(crawlJobs.id, job.id));
    if (retry) {
      await tx
        .update(sources)
        .set({
          status: "pending",
          errorCode: "RETRY_SCHEDULED",
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(sources.id, job.sourceId));
    } else {
      await markSourceBroken(tx, job.sourceId, "CRAWL_FAILED", message);
    }
  });
  logger.error({ error, jobId: job.id, retry, attempt }, "Crawl job failed");
  captureWorkerException(error, {
    jobId: job.id,
    sourceId: job.sourceId,
    retry,
    attempt,
  });
  await recordSystemLog("error", "Crawl job failed", {
    jobId: job.id,
    sourceId: job.sourceId,
    retry,
    attempt,
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
  lastStaleScan = 0;
  await warnAboutPeers();
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
        await recoverStaleJobs();
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
          } else if (error instanceof WorkerStopping) {
            // Handed back before this process exits, so the next worker can
            // start on it immediately instead of waiting for the job to be
            // noticed as abandoned.
            await handBackJob(
              job,
              "WORKER_RESTARTED",
              "The worker was restarted while this job was running, so it was returned to the queue.",
            );
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
    // Two flags, because they are read in two places. `stopping` ends the poll
    // loop; the shutdown flag unwinds a job that is already running. Setting
    // only the first is what made every restart a hard kill: the signal was
    // acknowledged, the in-flight crawl carried on regardless, and the
    // supervisor eventually resorted to SIGKILL - which leaves no chance to put
    // the job back, so it sat locked by a process that no longer existed.
    stopping = true;
    beginWorkerShutdown();
    logger.info({ signal, workerId }, "Worker shutting down");
  });
}

run().catch((error) => {
  logger.fatal({ error }, "Worker crashed");
  captureWorkerException(error, { workerId });
  process.exitCode = 1;
});
