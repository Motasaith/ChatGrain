import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { cancelJobs } from "@/lib/jobs/cancel-jobs";
import { recordAudit } from "@/lib/observability/audit";

type RouteContext = { params: Promise<{ jobId: string }> };

async function ownedJob(jobId: string, workspaceId: string) {
  const [result] = await db
    .select({
      id: crawlJobs.id,
      status: crawlJobs.status,
      batchId: crawlJobs.batchId,
      sourceId: sources.id,
      workspaceId: agents.workspaceId,
    })
    .from(crawlJobs)
    .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
    .innerJoin(agents, eq(agents.id, sources.agentId))
    .where(eq(crawlJobs.id, jobId))
    .limit(1);
  if (!result || result.workspaceId !== workspaceId) {
    throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
  }
  return result;
}

/** Stops one job. */
export async function POST(_: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { jobId } = await context.params;
    const workspace = await getWorkspaceContext();
    const job = await ownedJob(jobId, workspace.workspaceId);
    if (!["queued", "running"].includes(job.status)) {
      throw new AppError(
        "JOB_NOT_RUNNING",
        "This job has already finished.",
        409,
      );
    }
    const result = await cancelJobs([jobId]);
    await recordAudit({
      workspaceId: workspace.workspaceId,
      actorUserId: workspace.userId,
      actorEmail: workspace.email,
      action: "source.training_cancelled",
      targetType: "source",
      targetId: job.sourceId,
      message: "Training stopped before any data was indexed.",
    });
    return NextResponse.json({
      data: { stopping: result.stopping.length > 0 },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/**
 * Stops every job in one upload batch.
 *
 * A batch of thirty files is thirty jobs, and asking the operator to press stop
 * thirty times would be its own bug.
 */
export async function DELETE(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { jobId } = await context.params;
    const workspace = await getWorkspaceContext();
    const anchor = await ownedJob(jobId, workspace.workspaceId);
    if (!anchor.batchId) return POST(request, context);

    const siblings = await db
      .select({ id: crawlJobs.id })
      .from(crawlJobs)
      .where(
        and(
          eq(crawlJobs.batchId, anchor.batchId),
          inArray(crawlJobs.status, ["queued", "running"]),
        ),
      );
    const result = await cancelJobs(siblings.map((job) => job.id));
    await recordAudit({
      workspaceId: workspace.workspaceId,
      actorUserId: workspace.userId,
      actorEmail: workspace.email,
      action: "source.training_cancelled",
      targetType: "agent",
      targetId: anchor.sourceId,
      message: `Stopped ${siblings.length} queued or running file job(s).`,
    });
    return NextResponse.json({
      data: { stopping: result.stopping.length },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
