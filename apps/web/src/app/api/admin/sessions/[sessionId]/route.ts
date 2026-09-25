import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/lib/auth/session";
import {
  restoreSnapshot,
  type WorkspaceSnapshot,
} from "@/lib/auth/workspace-snapshot";
import { db } from "@/lib/db/client";
import { adminSessions, workspaces } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";

type Context = { params: Promise<{ sessionId: string }> };

/**
 * Rolling back an editing session after the fact.
 *
 * The reason the snapshot is not thrown away when a session ends. Two cases it
 * answers, and both of them happen:
 *
 * A session that nobody closed properly - an expired one, a shut laptop - kept
 * its changes because silently undoing an administrator's finished work would
 * leave the customer broken and nobody any the wiser. This is how those get
 * reviewed afterwards instead of being permanent by accident.
 *
 * And a support fix that turned out to make things worse. "Can you put it back
 * how it was?" is a reasonable thing for a customer to ask a week later, and
 * without this the answer is no.
 */
export async function POST(_: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const { sessionId } = await context.params;

    const [session] = await db
      .select()
      .from(adminSessions)
      .where(eq(adminSessions.id, sessionId))
      .limit(1);
    if (!session) {
      throw new AppError("SESSION_NOT_FOUND", "Session not found.", 404);
    }
    if (session.status === "reverted" || session.status === "discarded") {
      throw new AppError(
        "ALREADY_REVERTED",
        "This session has already been rolled back.",
        409,
      );
    }

    // Pruned by the retention job: the record of what changed survives, the
    // copy needed to put it back does not.
    if (session.status === "expired") {
      throw new AppError(
        "RESTORE_POINT_EXPIRED",
        "This session's restore point has been pruned, so it can no longer be rolled back.",
        410,
      );
    }

    const [workspace] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, session.workspaceId))
      .limit(1);

    // Anything the customer touched after the session ended is theirs, not the
    // administrator's, and is left exactly as it is. A rollback that quietly
    // undid a week of the customer's own edits would be far worse than the
    // support change it was meant to correct.
    const endedAt = session.endedAt ?? session.startedAt;
    const result = await restoreSnapshot(
      session.snapshot as WorkspaceSnapshot,
      session.workspaceId,
      { endedAt },
    );

    await db
      .update(adminSessions)
      .set({
        status: "reverted",
        decidedAt: new Date(),
        decidedBy: identity.email,
        summary: {
          ...((session.summary as Record<string, unknown>) ?? {}),
          revertedRows: result.restored,
          skipped: result.skipped,
        },
      })
      .where(eq(adminSessions.id, sessionId));

    await recordAudit({
      workspaceId: session.workspaceId,
      actorEmail: identity.email,
      action: "admin.session_reverted",
      targetType: "workspace",
      targetId: session.workspaceId,
      message:
        `${identity.email} rolled back ${session.adminEmail}'s session on ` +
        `${workspace?.name ?? "a workspace"}, restoring ${result.restored} row(s)`,
      metadata: {
        sessionId,
        startedAt: session.startedAt.toISOString(),
        skipped: result.skipped,
      },
      requestId,
    });

    return NextResponse.json({ data: result, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
