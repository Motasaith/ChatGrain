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
import { activeGrant } from "@/lib/auth/impersonation-grant";
import { db } from "@/lib/db/client";
import { agents, conversations, workspaces } from "@/lib/db/schema";
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
  /**
   * Which tier. The lowest one unless deliberately raised, and `write` cannot
   * be reached at all without the customer's recorded consent.
   */
  mode: z.enum(["read", "sandbox", "write"]).default("read"),
  minutes: z.number().int().min(1).max(IMPERSONATION_MAX_MINUTES).optional(),
  /** Why. Free text, stored on the audit row. */
  reason: z.string().max(500).optional(),
});

const MODE_WORDING = {
  read: "read-only",
  sandbox: "in a sandbox",
  write: "with permission to make changes",
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

    // Checked here rather than trusted from the cookie, because a cookie is
    // minted once and consent can be withdrawn afterwards.
    let grantExpiresAt: Date | null = null;
    if (input.mode === "write") {
      const grant = await activeGrant(workspace.id, identity.email);
      if (!grant) {
        throw new AppError(
          "CONSENT_REQUIRED",
          `${workspace.name} has not given you permission to change anything. ` +
            "Request it, and they will be asked to approve. A sandbox session " +
            "needs no permission and can reproduce most faults.",
          403,
        );
      }
      grantExpiresAt = grant.grantExpiresAt;
    }

    const session = impersonationSession(
      workspace.id,
      workspace.name,
      identity.email,
      { mode: input.mode, minutes: input.minutes },
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
        expiresAt: new Date(session.expiresAt).toISOString(),
        grantExpiresAt: grantExpiresAt?.toISOString() ?? null,
        reason: input.reason ?? null,
      },
      requestId,
    });

    const response = NextResponse.json({
      data: {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        mode: session.mode,
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
 * This is what makes the promise on the banner true. A sandbox conversation is
 * a real row while the session lasts - it has to be, because the agent reads
 * its own history back out of the database to answer a follow-up - and it stops
 * being one when the session ends.
 *
 * Every sandbox conversation in the workspace is removed, not only this
 * session's. A session that ended by expiry, a closed tab or a crashed process
 * never reaches this code, so scoping the cleanup narrowly would slowly
 * accumulate exactly the rows this feature promises not to leave behind.
 * Nothing else writes this channel, so there is nothing else to catch.
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

/**
 * Ends the session.
 *
 * Exempted from the write rules in the proxy - the exit cannot be behind the
 * lock, or an administrator is stuck until the session expires.
 */
export async function DELETE() {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const session = await readImpersonation();

    let discarded = 0;
    if (session) {
      if (session.mode === "sandbox") {
        discarded = await discardSandboxData(session.workspaceId);
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
        metadata: { mode: session.mode, discarded },
        requestId,
      });
    }

    const response = NextResponse.json({
      data: { ended: Boolean(session), discarded },
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
