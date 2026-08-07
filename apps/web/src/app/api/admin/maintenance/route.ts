import * as Sentry from "@sentry/nextjs";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cleanupInactiveUsers } from "@/lib/admin/retention";
import { requireAdminIdentity } from "@/lib/auth/session";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources } from "@/lib/db/schema";
import { errorResponse, readJson } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";

const inputSchema = z.object({
  action: z.enum([
    "cleanup-preview",
    "cleanup-run",
    "retry-failed-jobs",
    "sentry-test",
  ]),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await requireAdminIdentity();
    const [context, input] = await Promise.all([
      getWorkspaceContext(),
      readJson(request).then((value) => inputSchema.parse(value)),
    ]);

    if (input.action === "cleanup-preview") {
      const result = await cleanupInactiveUsers({ dryRun: true });
      return NextResponse.json({ data: result, requestId });
    }

    if (input.action === "cleanup-run") {
      const result = await cleanupInactiveUsers();
      await recordAudit({
        workspaceId: context.workspaceId,
        actorUserId: context.userId,
        actorEmail: context.email,
        action: "admin.retention_run",
        targetType: "system",
        message: `Retention cleanup deleted ${result.deletedUsers} users and ${result.deletedWorkspaces} workspaces.`,
        metadata: result,
        requestId,
      });
      return NextResponse.json({ data: result, requestId });
    }

    if (input.action === "sentry-test") {
      Sentry.captureException(
        new Error("ChatGrain administrator-triggered Sentry verification"),
        {
          tags: { verification: "admin-dashboard" },
          user: { id: context.userId, email: context.email },
        },
      );
      await Sentry.flush(2_000);
      await recordAudit({
        workspaceId: context.workspaceId,
        actorUserId: context.userId,
        actorEmail: context.email,
        action: "admin.sentry_test",
        targetType: "system",
        message: "Sent a verification error to Sentry.",
        requestId,
      });
      return NextResponse.json({
        data: { message: "Verification event sent to Sentry." },
        requestId,
      });
    }

    const failed = await db
      .select({ jobId: crawlJobs.id, sourceId: crawlJobs.sourceId })
      .from(crawlJobs)
      .where(eq(crawlJobs.status, "failed"))
      .limit(500);
    if (failed.length) {
      const sourceIds = [...new Set(failed.map((job) => job.sourceId))];
      const failedSources = await db
        .select({ id: sources.id, agentId: sources.agentId })
        .from(sources)
        .where(inArray(sources.id, sourceIds));
      await db.transaction(async (tx) => {
        await tx
          .update(crawlJobs)
          .set({
            status: "queued",
            attempt: 0,
            lockedAt: null,
            lockedBy: null,
            startedAt: null,
            finishedAt: null,
            nextAttemptAt: new Date(),
            errorCode: null,
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(crawlJobs.status, "failed"),
              inArray(
                crawlJobs.id,
                failed.map((job) => job.jobId),
              ),
            ),
          );
        await tx
          .update(sources)
          .set({
            status: "pending",
            errorCode: null,
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(inArray(sources.id, sourceIds));
        const agentIds = [
          ...new Set(failedSources.map((source) => source.agentId)),
        ];
        if (agentIds.length) {
          await tx
            .update(agents)
            .set({ status: "training", updatedAt: new Date() })
            .where(inArray(agents.id, agentIds));
        }
      });
    }
    await recordAudit({
      workspaceId: context.workspaceId,
      actorUserId: context.userId,
      actorEmail: context.email,
      action: "admin.jobs_retried",
      targetType: "crawl_job",
      message: `Returned ${failed.length} failed crawl jobs to the queue.`,
      metadata: { count: failed.length },
      requestId,
    });
    return NextResponse.json({
      data: { retriedJobs: failed.length },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
