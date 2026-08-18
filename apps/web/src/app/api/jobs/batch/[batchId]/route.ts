import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";

type RouteContext = { params: Promise<{ batchId: string }> };

/**
 * Progress for one multi-file upload.
 *
 * A batch is one job per file, so that a single unreadable PDF fails on its own
 * rather than taking the other twenty-nine with it. Polling them individually
 * would mean one request per file per tick, so the roll-up happens here.
 */
export async function GET(_: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { batchId } = await context.params;
    const workspace = await getWorkspaceContext();
    const rows = await db
      .select({
        id: crawlJobs.id,
        status: crawlJobs.status,
        phase: crawlJobs.phase,
        progress: crawlJobs.progress,
        pagesDiscovered: crawlJobs.pagesDiscovered,
        pagesProcessed: crawlJobs.pagesProcessed,
        pagesEmbedded: crawlJobs.pagesEmbedded,
        pagesSkipped: crawlJobs.pagesSkipped,
        chunksIndexed: crawlJobs.chunksIndexed,
        errorMessage: crawlJobs.errorMessage,
        cancelRequestedAt: crawlJobs.cancelRequestedAt,
        sourceId: sources.id,
        name: sources.name,
        workspaceId: agents.workspaceId,
      })
      .from(crawlJobs)
      .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
      .innerJoin(agents, eq(agents.id, sources.agentId))
      .where(eq(crawlJobs.batchId, batchId));

    if (!rows.length || rows[0].workspaceId !== workspace.workspaceId) {
      throw new AppError("BATCH_NOT_FOUND", "Upload not found.", 404);
    }

    const files = rows.map((row) => ({
      ...row,
      workspaceId: undefined,
      stopping: Boolean(row.cancelRequestedAt) && row.status === "running",
    }));
    const finished = files.filter((file) =>
      ["succeeded", "failed", "cancelled"].includes(file.status),
    );
    return NextResponse.json({
      data: {
        batchId,
        files,
        total: files.length,
        finished: finished.length,
        failed: files.filter((file) => file.status === "failed").length,
        cancelled: files.filter((file) => file.status === "cancelled").length,
        chunksIndexed: files.reduce(
          (total, file) => total + file.chunksIndexed,
          0,
        ),
        // One bar for the batch: each file counts for an equal share of it,
        // because file sizes are known but embedding time is not.
        progress: Math.round(
          files.reduce(
            (total, file) =>
              total +
              (["succeeded", "failed", "cancelled"].includes(file.status)
                ? 100
                : file.progress),
            0,
          ) / Math.max(1, files.length),
        ),
        active: files.length - finished.length,
      },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export const dynamic = "force-dynamic";
