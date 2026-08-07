import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import {
  agents,
  crawlJobs,
  crawlPages,
  sources,
  systemState,
} from "@/lib/db/schema";
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
          sql`${crawlPages.jobId} = ${jobId} and ${crawlPages.outcome} in ('failed', 'thin')`,
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

    return NextResponse.json({
      data: {
        ...result,
        workerHealthy,
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
