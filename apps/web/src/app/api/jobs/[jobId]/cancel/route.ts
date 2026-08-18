import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, documents, sources } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";

type RouteContext = { params: Promise<{ jobId: string }> };

/**
 * Asks the worker to stop a running job.
 *
 * The request cannot stop the work itself: the job is owned by whichever
 * worker claimed it. Writing the flag and letting that worker unwind at its
 * next checkpoint is what keeps the stop clean, because both processors hold
 * their results until one final transaction. Nothing half-indexed can survive.
 */
export async function POST(_: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { jobId } = await context.params;
    const workspace = await getWorkspaceContext();
    const [result] = await db
      .select({
        job: crawlJobs,
        sourceId: sources.id,
        workspaceId: agents.workspaceId,
      })
      .from(crawlJobs)
      .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
      .innerJoin(agents, eq(agents.id, sources.agentId))
      .where(eq(crawlJobs.id, jobId))
      .limit(1);
    if (!result || result.workspaceId !== workspace.workspaceId) {
      throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
    }
    if (!["queued", "running"].includes(result.job.status)) {
      throw new AppError(
        "JOB_NOT_RUNNING",
        "This job has already finished.",
        409,
      );
    }

    // A job that no worker has claimed can be closed out here, because there is
    // nobody to notice the flag.
    const cancelledNow = await db
      .update(crawlJobs)
      .set({
        status: "cancelled",
        cancelRequestedAt: new Date(),
        errorCode: "CANCELLED",
        errorMessage: "Stopped before any data was indexed.",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(crawlJobs.id, jobId), eq(crawlJobs.status, "queued")))
      .returning({ id: crawlJobs.id });

    if (cancelledNow.length) {
      // Same rule the worker applies: a source that never finished indexing
      // has nothing to show, and leaving it listed implies content the agent
      // cannot answer from. One that already has documents keeps them.
      const [indexed] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(documents)
        .where(eq(documents.sourceId, result.sourceId));
      if (indexed?.value) {
        await db
          .update(sources)
          .set({ status: "ready", updatedAt: new Date() })
          .where(eq(sources.id, result.sourceId));
      } else {
        await db.delete(sources).where(eq(sources.id, result.sourceId));
      }
    } else {
      await db
        .update(crawlJobs)
        .set({ cancelRequestedAt: new Date(), updatedAt: new Date() })
        .where(eq(crawlJobs.id, jobId));
    }

    await recordAudit({
      workspaceId: workspace.workspaceId,
      actorUserId: workspace.userId,
      actorEmail: workspace.email,
      action: "source.training_cancelled",
      targetType: "source",
      targetId: result.sourceId,
      message: "Training stopped before any data was indexed.",
    });

    return NextResponse.json({
      data: { stopping: !cancelledNow.length },
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
    const [anchor] = await db
      .select({ batchId: crawlJobs.batchId, workspaceId: agents.workspaceId })
      .from(crawlJobs)
      .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
      .innerJoin(agents, eq(agents.id, sources.agentId))
      .where(eq(crawlJobs.id, jobId))
      .limit(1);
    if (!anchor || anchor.workspaceId !== workspace.workspaceId) {
      throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
    }
    if (!anchor.batchId) {
      return POST(request, context);
    }
    const siblings = await db
      .select({ id: crawlJobs.id })
      .from(crawlJobs)
      .where(
        and(
          eq(crawlJobs.batchId, anchor.batchId),
          inArray(crawlJobs.status, ["queued", "running"]),
        ),
      );
    if (siblings.length) {
      await db
        .update(crawlJobs)
        .set({ cancelRequestedAt: new Date(), updatedAt: new Date() })
        .where(
          inArray(
            crawlJobs.id,
            siblings.map((job) => job.id),
          ),
        );
    }
    return NextResponse.json(
      { data: { stopping: siblings.length }, requestId },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
