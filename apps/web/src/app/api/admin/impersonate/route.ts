import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminIdentity } from "@/lib/auth/session";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_MAX_MINUTES,
  encodeImpersonation,
  impersonationSession,
  readImpersonation,
} from "@/lib/auth/impersonation";
import { activeGrant, consentRequired } from "@/lib/auth/impersonation-grant";
import {
  diffSnapshot,
  restoreSnapshot,
  takeSnapshot,
  type WorkspaceSnapshot,
} from "@/lib/auth/workspace-snapshot";
import { db } from "@/lib/db/client";
import {
  adminSessions,
  agents,
  conversations,
  workspaces,
} from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";
import { SANDBOX_CHANNEL } from "@/lib/chat/sandbox";

/**
 * Starting and ending an impersonation session.
 *
 * Both halves are audited, and both audit rows are written against the
 * workspace being entered rather than the administrator's own. Someone reading
 * their own audit trail should be able to see that an administrator was in
 * their account, when, and what they were able to do - that is the point of
 * recording it at all.
 */
const startSchema = z.object({
  workspaceId: z.uuid(),
  mode: z.enum(["read", "sandbox", "write"]).default("read"),
  minutes: z.number().int().min(1).max(IMPERSONATION_MAX_MINUTES).optional(),
  /** Why. Free text, stored on the audit row and on the restore point. */
  reason: z.string().max(500).optional(),
});

const MODE_WORDING = {
  read: "read-only",
  sandbox: "in a sandbox",
  write: "with changes that can be undone",
} as const;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const input = startSchema.parse(await request.json());

    const [workspace] = await db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (!workspace) {
      throw new AppError("WORKSPACE_NOT_FOUND", "Workspace not found.", 404);
    }

    /**
     * Entering an editing session copies the configuration first.
     *
     * This is what stands in place of asking the customer. They are not
     * interrupted, not asked to judge something they have no context for, and
     * not trained to click approval links in email - and nothing done here is
     * permanent until somebody decides it should be.
     */
    let sessionId: string | undefined;
    if (input.mode === "write") {
      // Consent is off unless an installation deliberately turns it on. Where
      // it is on, it gates entry exactly as before.
      if (consentRequired()) {
        const grant = await activeGrant(workspace.id, identity.email);
        if (!grant) {
          throw new AppError(
            "CONSENT_REQUIRED",
            `This installation requires ${workspace.name} to approve changes. ` +
              "Request it, and they will be asked.",
            403,
          );
        }
      }

      const snapshot = await takeSnapshot(workspace.id);
      const [row] = await db
        .insert(adminSessions)
        .values({
          workspaceId: workspace.id,
          adminEmail: identity.email,
          reason: input.reason ?? null,
          snapshot,
        })
        .returning({ id: adminSessions.id });
      sessionId = row.id;
    }

    const session = impersonationSession(
      workspace.id,
      workspace.name,
      identity.email,
      { mode: input.mode, minutes: input.minutes, sessionId },
    );

    await recordAudit({
      workspaceId: workspace.id,
      actorEmail: identity.email,
      action: `admin.impersonation_started_${input.mode}`,
      targetType: "workspace",
      targetId: workspace.id,
      message: `${identity.email} began viewing ${workspace.name} ${MODE_WORDING[input.mode]}`,
      metadata: {
        mode: input.mode,
        sessionId: sessionId ?? null,
        expiresAt: new Date(session.expiresAt).toISOString(),
        reason: input.reason ?? null,
      },
      requestId,
    });

    const response = NextResponse.json({
      data: {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        mode: session.mode,
        sessionId: sessionId ?? null,
        expiresAt: session.expiresAt,
      },
      requestId,
    });
    response.cookies.set({
      name: IMPERSONATION_COOKIE,
      value: await encodeImpersonation(session),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // The cookie's own lifetime matches the signed expiry. Both exist because
      // they fail differently: the browser drops it on time, and the signature
      // refuses it even if the browser does not.
      expires: new Date(session.expiresAt),
    });
    return response;
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/**
 * Throws away everything a sandbox session wrote.
 *
 * Every sandbox conversation in the workspace is removed, not only this
 * session's. A session that ended by expiry, a closed tab or a crashed process
 * never reaches this code, so scoping the cleanup narrowly would slowly
 * accumulate exactly the rows this feature promises not to leave behind.
 */
async function discardSandboxData(workspaceId: string) {
  const owned = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId));
  if (!owned.length) return 0;

  const removed = await db
    .delete(conversations)
    .where(
      and(
        inArray(
          conversations.agentId,
          owned.map((agent) => agent.id),
        ),
        eq(conversations.channel, SANDBOX_CHANNEL),
      ),
    )
    .returning({ id: conversations.id });
  return removed.length;
}

const endSchema = z.object({
  /**
   * What to do with an editing session's changes.
   *
   * `keep` is the default, and is what an abandoned session gets. Silently
   * undoing an administrator's completed work would leave the customer broken
   * with nobody any the wiser - so changes stay, and the restore point stays
   * with them, which is the part that makes keeping them defensible.
   */
  decision: z.enum(["keep", "discard"]).default("keep"),
});

export async function DELETE(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const session = await readImpersonation();
    const input = endSchema.parse(
      await request.json().catch(() => ({})),
    );

    let discarded = 0;
    let restored: Awaited<ReturnType<typeof restoreSnapshot>> | null = null;
    let changeCount = 0;

    if (session) {
      if (session.mode === "sandbox") {
        discarded = await discardSandboxData(session.workspaceId);
      }

      if (session.sessionId) {
        const [row] = await db
          .select()
          .from(adminSessions)
          .where(eq(adminSessions.id, session.sessionId))
          .limit(1);

        if (row && row.status === "open") {
          const before = row.snapshot as WorkspaceSnapshot;
          const after = await takeSnapshot(session.workspaceId);
          const changes = diffSnapshot(before, after);
          changeCount = changes.length;
          const endedAt = new Date();

          if (input.decision === "discard" && changes.length) {
            restored = await restoreSnapshot(before, session.workspaceId, {
              endedAt,
            });
          }

          await db
            .update(adminSessions)
            .set({
              status: input.decision === "discard" ? "discarded" : "kept",
              summary: { changes, skipped: restored?.skipped ?? [] },
              endedAt,
              decidedAt: endedAt,
              decidedBy: identity.email,
            })
            .where(eq(adminSessions.id, row.id));

          if (changes.length) {
            await recordAudit({
              workspaceId: session.workspaceId,
              actorEmail: identity.email,
              action:
                input.decision === "discard"
                  ? "admin.session_discarded"
                  : "admin.session_kept",
              targetType: "workspace",
              targetId: session.workspaceId,
              message:
                input.decision === "discard"
                  ? `${identity.email} undid ${changes.length} change(s) made during their session`
                  : `${identity.email} kept ${changes.length} change(s) made during their session`,
              metadata: {
                sessionId: row.id,
                changes: changes.slice(0, 50),
                skipped: restored?.skipped ?? [],
              },
              requestId,
            });
          }
        }
      }

      await recordAudit({
        workspaceId: session.workspaceId,
        actorEmail: identity.email,
        action: "admin.impersonation_ended",
        targetType: "workspace",
        targetId: session.workspaceId,
        message:
          `${identity.email} stopped viewing ${session.workspaceName}` +
          (discarded
            ? `, discarding ${discarded} sandbox conversation(s)`
            : ""),
        metadata: { mode: session.mode, discarded, changes: changeCount },
        requestId,
      });
    }

    const response = NextResponse.json({
      data: {
        ended: Boolean(session),
        discarded,
        changes: changeCount,
        restored: restored?.restored ?? 0,
        skipped: restored?.skipped ?? [],
      },
      requestId,
    });
    // Cleared whether or not one was found. A cookie that failed verification
    // still exists in the browser, and leaving it there means the next request
    // carries the same unusable value again.
    response.cookies.set({
      name: IMPERSONATION_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
