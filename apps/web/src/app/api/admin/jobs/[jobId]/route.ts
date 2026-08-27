import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminIdentity } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources, workspaces } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { cancelJobs } from "@/lib/jobs/cancel-jobs";
import { recordAudit } from "@/lib/observability/audit";

type Context = { params: Promise<{ jobId: string }> };

/**
 * Job control that is not scoped to the caller's own workspace.
 *
 * This exists because of a real evening. Someone started training an agent,
 * left, and the job ran overnight stuck at 0% on a build with a known fault.
 * Nobody else could stop it: every job route resolves through
 * `agents.workspaceId` and answers `JOB_NOT_FOUND` when it does not match the
 * caller, so an administrator got the same 404 as a stranger. The choices were
 * to wait for that person to come back, or to open psql.
 *
 * Deliberately a separate route rather than a flag on the existing one. The
 * shortcut - making `getWorkspaceContext()` return everything for an
 * administrator - would silently widen every endpoint in the application at
 * once, including ones written on the assumption that scoping is guaranteed.
 * Here the absence of a workspace filter is the obvious and intended reading of
 * the file, and the path says so.
 */
const schema = z.object({
  action: z.enum(["cancel", "retry"]),
});

/** The job, with enough context for the audit entry to be worth reading. */
async function findJob(jobId: string) {
  const [job] = await db
    .select({
      id: crawlJobs.id,
      status: crawlJobs.status,
      phase: crawlJobs.phase,
      progress: crawlJobs.progress,
      attempt: crawlJobs.attempt,
      maxAttempts: crawlJobs.maxAttempts,
      lockedBy: crawlJobs.lockedBy,
      sourceId: sources.id,
      sourceName: sources.name,
      agentId: agents.id,
      agentName: agents.name,
      workspaceId: agents.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(crawlJobs)
    .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
    .innerJoin(agents, eq(agents.id, sources.agentId))
    .innerJoin(workspaces, eq(workspaces.id, agents.workspaceId))
    .where(eq(crawlJobs.id, jobId))
    .limit(1);
  if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
  return job;
}

export async function POST(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const { jobId } = await context.params;
    const { action } = schema.parse(await request.json());
    const job = await findJob(jobId);

    if (action === "cancel") {
      if (!["queued", "awaiting_review", "running"].includes(job.status)) {
        throw new AppError(
          "JOB_NOT_ACTIVE",
          `This job is already ${job.status}.`,
          409,
        );
      }
      const result = await cancelJobs([job.id]);
      // Recorded against the workspace that owns the job, not the
      // administrator's own. Someone reading that workspace's audit trail
      // should find out their crawl was stopped, and by whom.
      await recordAudit({
        workspaceId: job.workspaceId,
        actorEmail: identity.email,
        action: "admin.job_cancelled",
        targetType: "crawl_job",
        targetId: job.id,
        message: `Administrator stopped the crawl of ${job.sourceName} (${job.agentName})`,
        metadata: {
          status: job.status,
          phase: job.phase,
          progress: job.progress,
          lockedBy: job.lockedBy,
          workspace: job.workspaceName,
        },
        requestId,
      });
      return NextResponse.json({ data: { job: job.id, ...result }, requestId });
    }

    if (!["failed", "partial", "cancelled"].includes(job.status)) {
      throw new AppError(
        "JOB_NOT_RETRYABLE",
        `This job is ${job.status}, so there is nothing to retry.`,
        409,
      );
    }
    // Attempts are reset rather than incremented. An administrator retrying a
    // job by hand has made a judgement that the previous failures are not
    // predictive - usually because whatever caused them has been fixed - and a
    // retry that is refused for having no attempts left would be useless.
    const [updated] = await db
      .update(crawlJobs)
      .set({
        status: "queued",
        attempt: 0,
        nextAttemptAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        finishedAt: null,
        cancelRequestedAt: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(crawlJobs.id, job.id))
      .returning();
    await db
      .update(sources)
      .set({ status: "pending", errorCode: null, errorMessage: null, updatedAt: new Date() })
      .where(eq(sources.id, job.sourceId));
    await recordAudit({
      workspaceId: job.workspaceId,
      actorEmail: identity.email,
      action: "admin.job_retried",
      targetType: "crawl_job",
      targetId: job.id,
      message: `Administrator retried the crawl of ${job.sourceName} (${job.agentName})`,
      metadata: {
        previousStatus: job.status,
        previousAttempts: job.attempt,
        workspace: job.workspaceName,
      },
      requestId,
    });
    return NextResponse.json({ data: { job: updated }, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
