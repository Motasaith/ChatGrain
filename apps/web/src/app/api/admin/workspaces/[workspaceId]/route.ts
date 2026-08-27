import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminIdentity } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources, workspaces } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { cancelJobs } from "@/lib/jobs/cancel-jobs";
import { recordAudit } from "@/lib/observability/audit";

type Context = { params: Promise<{ workspaceId: string }> };

/**
 * Per-workspace controls: suspension, and a page limit of its own.
 *
 * Both exist because every limit in this application was an environment
 * variable, so raising one customer's allowance meant an SSH session and a
 * restart applied to everybody, and there was no way at all to stop one
 * workspace without stopping the installation.
 */
const schema = z.object({
  /** Null lifts the suspension. */
  suspended: z.boolean().optional(),
  reason: z.string().max(500).optional(),
  /** Null returns this workspace to the installation-wide limit. */
  pageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  /** Null lifts the floor and lets each source keep its own cadence. */
  minRefreshHours: z.number().int().min(1).max(8_760).nullable().optional(),
});

export async function PATCH(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const { workspaceId } = await context.params;
    const input = schema.parse(await request.json());

    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!workspace) {
      throw new AppError("WORKSPACE_NOT_FOUND", "Workspace not found.", 404);
    }

    const changes: Record<string, unknown> = { updatedAt: new Date() };
    if (input.suspended !== undefined) {
      changes.suspendedAt = input.suspended ? new Date() : null;
      changes.suspendedReason = input.suspended ? (input.reason ?? null) : null;
    }
    if (input.pageLimit !== undefined) changes.pageLimit = input.pageLimit;
    if (input.minRefreshHours !== undefined) {
      changes.minRefreshHours = input.minRefreshHours;
    }

    const [updated] = await db
      .update(workspaces)
      .set(changes)
      .where(eq(workspaces.id, workspaceId))
      .returning();

    // Suspending stops the worker picking up new jobs, but a crawl already
    // running has a worker of its own and would carry on for hours - which is
    // usually the exact thing the suspension is meant to stop. Anything queued
    // is left alone: it is not consuming anything, and lifting the suspension
    // should resume it rather than require someone to start it again.
    let stopped = 0;
    if (input.suspended) {
      const running = await db
        .select({ id: crawlJobs.id })
        .from(crawlJobs)
        .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
        .innerJoin(agents, eq(agents.id, sources.agentId))
        .where(
          and(
            eq(agents.workspaceId, workspaceId),
            eq(crawlJobs.status, "running"),
          ),
        );
      if (running.length) {
        await cancelJobs(running.map((job) => job.id));
        stopped = running.length;
      }
    }

    if (input.suspended !== undefined) {
      await recordAudit({
        workspaceId,
        actorEmail: identity.email,
        action: input.suspended
          ? "admin.workspace_suspended"
          : "admin.workspace_resumed",
        targetType: "workspace",
        targetId: workspaceId,
        message: input.suspended
          ? `Administrator suspended ${workspace.name}${stopped ? `, stopping ${stopped} running crawl(s)` : ""}`
          : `Administrator lifted the suspension on ${workspace.name}`,
        metadata: { reason: input.reason ?? null, stoppedJobs: stopped },
        requestId,
      });
    }
    if (input.pageLimit !== undefined) {
      await recordAudit({
        workspaceId,
        actorEmail: identity.email,
        action: "admin.workspace_page_limit",
        targetType: "workspace",
        targetId: workspaceId,
        message:
          input.pageLimit === null
            ? `Administrator returned ${workspace.name} to the default page limit`
            : `Administrator set ${workspace.name}'s page limit to ${input.pageLimit.toLocaleString()}`,
        metadata: { from: workspace.pageLimit, to: input.pageLimit },
        requestId,
      });
    }

    return NextResponse.json({
      data: { workspace: updated, stoppedJobs: stopped },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

const deleteSchema = z.object({
  /**
   * The workspace's own name, typed by the administrator.
   *
   * Deliberately not a checkbox. This cascades through agents, sources,
   * documents and chunks and cannot be undone from the interface, and the
   * difference between clicking the wrong row and typing the wrong name by hand
   * is the whole of the protection.
   */
  confirmName: z.string().min(1),
});

/**
 * Deletes a workspace and everything under it.
 *
 * The plan's rule was "suspend before delete, everywhere": every destructive
 * action gets a reversible sibling and a confirmation naming what will be lost.
 * Suspension is that sibling, so this refuses to run on a workspace that is not
 * suspended - not to be obstructive, but because the reversible thing should be
 * tried first, and someone who has suspended a workspace and come back later is
 * making a different decision from someone who clicked twice in a row.
 */
export async function DELETE(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const { workspaceId } = await context.params;
    const input = deleteSchema.parse(await request.json());

    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!workspace) {
      throw new AppError("WORKSPACE_NOT_FOUND", "Workspace not found.", 404);
    }
    if (input.confirmName.trim() !== workspace.name) {
      throw new AppError(
        "CONFIRMATION_MISMATCH",
        "That is not this workspace's name.",
        400,
      );
    }
    if (!workspace.suspendedAt) {
      throw new AppError(
        "SUSPEND_FIRST",
        `Suspend ${workspace.name} before deleting it. If it turns out to be the wrong one, a suspension can be lifted and this cannot.`,
        409,
      );
    }

    const owned = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.workspaceId, workspaceId));

    // Written before the delete, because the workspace it refers to is about to
    // stop existing - and a foreign key would take the audit row with it.
    await recordAudit({
      workspaceId: null,
      actorEmail: identity.email,
      action: "admin.workspace_deleted",
      targetType: "workspace",
      targetId: workspaceId,
      message: `Administrator deleted ${workspace.name} and its ${owned.length} agent(s)`,
      metadata: {
        name: workspace.name,
        agents: owned.length,
        suspendedAt: workspace.suspendedAt?.toISOString() ?? null,
        suspendedReason: workspace.suspendedReason,
      },
      requestId,
    });

    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));

    return NextResponse.json({
      data: { deleted: workspace.name, agents: owned.length },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/**
 * What deleting this workspace would destroy.
 *
 * Read before the act, not reported after it. Deleting cascades to agents,
 * sources, documents and chunks, and "are you sure" is not a question anybody
 * can answer without the numbers.
 */
export async function GET(_: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    await requireAdminIdentity();
    const { workspaceId } = await context.params;

    const owned = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.workspaceId, workspaceId));
    const agentIds = owned.map((row) => row.id);

    const [sourceCount] = agentIds.length
      ? await db
          .select({ value: sql<number>`count(*)::int` })
          .from(sources)
          .where(inArray(sources.agentId, agentIds))
      : [{ value: 0 }];

    return NextResponse.json({
      data: { agents: agentIds.length, sources: sourceCount?.value ?? 0 },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
