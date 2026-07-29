import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources, systemState } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";

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
    const [owners, workerStates] = await Promise.all([
      db
        .select({ workspaceId: agents.workspaceId })
        .from(agents)
        .where(eq(agents.id, result.source.agentId))
        .limit(1),
      db
        .select({ updatedAt: systemState.updatedAt })
        .from(systemState)
        .where(eq(systemState.key, "worker"))
        .limit(1),
    ]);
    const owner = owners[0];
    if (owner?.workspaceId !== workspace.workspaceId) {
      throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
    }
    const workerUpdatedAt = workerStates[0]?.updatedAt;
    const workerHealthy = Boolean(
      workerUpdatedAt &&
        Date.now() - workerUpdatedAt.getTime() < 15_000,
    );
    return NextResponse.json({
      data: { ...result, workerHealthy },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
