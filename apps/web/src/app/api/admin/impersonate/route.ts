import { eq } from "drizzle-orm";
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
import { db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";

/**
 * Starting and ending an impersonation session.
 *
 * Both halves are audited, and both audit rows are written against the
 * workspace being entered rather than the administrator's own. Someone reading
 * their own audit trail should be able to see that an administrator was in
 * their account, when, and whether they could change anything - that is the
 * point of recording it at all.
 */
const startSchema = z.object({
  workspaceId: z.uuid(),
  /**
   * Off unless deliberately turned on, and a separate audit entry when it is.
   * Most support requests are "show me what they see", which needs no writes.
   */
  canWrite: z.boolean().default(false),
  minutes: z.number().int().min(1).max(IMPERSONATION_MAX_MINUTES).optional(),
  /** Why. Free text, stored on the audit row. */
  reason: z.string().max(500).optional(),
});

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

    const session = impersonationSession(
      workspace.id,
      workspace.name,
      identity.email,
      { canWrite: input.canWrite, minutes: input.minutes },
    );

    await recordAudit({
      workspaceId: workspace.id,
      actorEmail: identity.email,
      action: input.canWrite
        ? "admin.impersonation_started_write"
        : "admin.impersonation_started",
      targetType: "workspace",
      targetId: workspace.id,
      message: `${identity.email} began viewing ${workspace.name}${
        input.canWrite ? " with permission to make changes" : " (read-only)"
      }`,
      metadata: {
        canWrite: input.canWrite,
        expiresAt: new Date(session.expiresAt).toISOString(),
        reason: input.reason ?? null,
      },
      requestId,
    });

    const response = NextResponse.json({
      data: {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        canWrite: session.canWrite,
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
 * Ends the session.
 *
 * Exempted from the read-only rule in the proxy - the exit cannot be behind the
 * lock, or an administrator is stuck until the session expires.
 */
export async function DELETE() {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const session = await readImpersonation();

    if (session) {
      await recordAudit({
        workspaceId: session.workspaceId,
        actorEmail: identity.email,
        action: "admin.impersonation_ended",
        targetType: "workspace",
        targetId: session.workspaceId,
        message: `${identity.email} stopped viewing ${session.workspaceName}`,
        metadata: { canWrite: session.canWrite },
        requestId,
      });
    }

    const response = NextResponse.json({
      data: { ended: Boolean(session) },
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
