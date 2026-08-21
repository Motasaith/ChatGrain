import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import {
  agents,
  crawlJobs,
  crawlPages,
  documents,
  sources,
  systemState,
} from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import {
  holderIsAlive,
  secondsUntilReclaim,
  workerHeartbeatKey,
} from "@/lib/jobs/liveness";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(_: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { jobId } = await context.params;
    const workspace = await getWorkspaceContext();
    const [result] = await db
      .select({ job: crawlJobs, source: sources })
      .from(crawlJobs)
      .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
      .innerJoin(agents, eq(agents.id, sources.agentId))
      .where(eq(crawlJobs.id, jobId))
      .limit(1);
    if (!result) {
      throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
    }
    // Two heartbeat keys, answering two different questions. The shared "worker"
    // key answers "is anything processing jobs at all". The holder's own key
    // answers "is the process that took this job still alive" - which the shared
    // key cannot, because any second worker overwrites it, making a job orphaned
    // by a dead worker look healthy for as long as some other worker is beating.
    const holderKey = result.job.lockedBy
      ? workerHeartbeatKey(result.job.lockedBy)
      : null;
    const [owners, workerStates] = await Promise.all([
      db
        .select({ workspaceId: agents.workspaceId })
        .from(agents)
        .where(eq(agents.id, result.source.agentId))
        .limit(1),
      db
        .select({
          key: systemState.key,
          updatedAt: systemState.updatedAt,
          value: systemState.value,
        })
        .from(systemState)
        .where(
          inArray(
            systemState.key,
            holderKey ? ["worker", holderKey] : ["worker"],
          ),
        ),
    ]);
    const owner = owners[0];
    if (owner?.workspaceId !== workspace.workspaceId) {
      throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
    }
    const workerUpdatedAt = workerStates.find(
      (row) => row.key === "worker",
    )?.updatedAt;
    const workerHealthy = Boolean(
      workerUpdatedAt &&
        Date.now() - workerUpdatedAt.getTime() < 15_000,
    );

    // Counts are aggregated in the database and only a small sample of rows is
    // returned: a large site produces thousands of page records and the client
    // only needs totals plus whatever went wrong.
    const [outcomeRows, failures, recent] = await Promise.all([
      db
        .select({
          outcome: crawlPages.outcome,
          count: sql<number>`count(*)::int`,
        })
        .from(crawlPages)
        .where(eq(crawlPages.jobId, jobId))
        .groupBy(crawlPages.outcome),
      db
        .select({
          url: crawlPages.url,
          title: crawlPages.title,
          reason: crawlPages.reason,
          outcome: crawlPages.outcome,
        })
        .from(crawlPages)
        .where(
          sql`${crawlPages.jobId} = ${jobId} and ${crawlPages.outcome} in ('blocked', 'failed', 'thin')`,
        )
        .orderBy(desc(crawlPages.sequence))
        .limit(50),
      db
        .select({
          url: crawlPages.url,
          title: crawlPages.title,
          outcome: crawlPages.outcome,
          createdAt: crawlPages.createdAt,
        })
        .from(crawlPages)
        .where(eq(crawlPages.jobId, jobId))
        // Ordered by crawl sequence, not timestamp: batched inserts share a
        // clock reading and would otherwise come back in arbitrary order.
        .orderBy(desc(crawlPages.sequence))
        .limit(12),
    ]);

    // Which worker, and is it the one holding this job? A silent holder means
    // the job is waiting to be reclaimed, not progressing.
    const now = Date.now();
    const holderBeat = holderKey
      ? (workerStates.find((row) => row.key === holderKey) ?? null)
      : null;
    const sharedBeat = workerStates.find((row) => row.key === "worker") ?? null;
    // Prefer the holder's own row: on a machine running more than one worker,
    // the shared row's memory and id belong to whichever beat last, not to the
    // process doing this job.
    const beat = holderBeat ?? sharedBeat;
    const beatValue = (beat?.value ?? {}) as {
      workerId?: string;
      memoryMb?: number;
    };
    const holderBeatAt = holderBeat?.updatedAt ?? null;
    const holdsThisJob =
      Boolean(result.job.lockedBy) && holderIsAlive(now, holderBeatAt);
    const reclaimInSeconds =
      result.job.status === "running" && !holdsThisJob
        ? secondsUntilReclaim({
            now,
            holderBeatAt,
            lockedAt: result.job.lockedAt,
          })
        : null;
    // Pages already committed under this job. A crashed run keeps them, so this
    // is what a resumed attempt will not have to do again.
    const [durable] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(documents)
      .where(
        and(
          eq(documents.sourceId, result.source.id),
          eq(documents.runId, jobId),
        ),
      );

    return NextResponse.json({
      data: {
        ...result,
        workerHealthy,
        worker: {
          id: beatValue.workerId ?? null,
          memoryMb: beatValue.memoryMb ?? null,
          secondsSinceHeartbeat: beat?.updatedAt
            ? Math.round((now - beat.updatedAt.getTime()) / 1000)
            : null,
          holdsThisJob,
          // Counts down to the moment another worker may take this over. Null
          // whenever the holder is alive and there is nothing to wait for.
          reclaimInSeconds,
        },
        durablePages: durable?.value ?? 0,
        secondsSinceProgress: Math.round(
          (Date.now() - result.job.updatedAt.getTime()) / 1000,
        ),
        outcomes: Object.fromEntries(
          outcomeRows.map((row) => [row.outcome, row.count]),
        ),
        problemPages: failures,
        recentPages: recent,
      },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
