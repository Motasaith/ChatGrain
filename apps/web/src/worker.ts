import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, lt, lte, sql } from "drizzle-orm";
import { processCrawlJob } from "@/lib/crawl/process-job";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources, systemState } from "@/lib/db/schema";
import { logger } from "@/lib/observability/logger";

const workerId = `worker_${randomUUID().slice(0, 8)}`;
const pollInterval = Number(process.env.WORKER_POLL_MS ?? 1_200);
let stopping = false;
let lastRefreshScan = 0;

async function heartbeat() {
  await db
    .insert(systemState)
    .values({
      key: "worker",
      value: { workerId, pid: process.pid },
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: systemState.key,
      set: {
        value: { workerId, pid: process.pid },
        updatedAt: new Date(),
      },
    });
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

async function claimJob() {
  const candidates = await db
    .select()
    .from(crawlJobs)
    .where(
      and(
        eq(crawlJobs.status, "queued"),
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
}

async function run() {
  await recoverStaleJobs();
  logger.info({ workerId, pollInterval }, "Docent worker started");
  while (!stopping) {
    try {
      await heartbeat();
      await scheduleRefreshes();
      const job = await claimJob();
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        continue;
      }
      try {
        await processCrawlJob(job.id, job.sourceId);
      } catch (error) {
        await failJob(job, error);
      }
    } catch (error) {
      logger.error({ error }, "Worker poll failed");
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  logger.info({ workerId }, "Docent worker stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

run().catch((error) => {
  logger.fatal({ error }, "Worker crashed");
  process.exitCode = 1;
});
