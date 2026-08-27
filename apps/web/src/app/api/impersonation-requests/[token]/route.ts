import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { GRANT_TTL_HOURS, hoursFromNow } from "@/lib/auth/impersonation-grant";
import { db } from "@/lib/db/client";
import { impersonationGrants, workspaces } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";

type Context = { params: Promise<{ token: string }> };

/**
 * The customer's answer to "may I change your account?".
 *
 * Two things have to be true, and neither is sufficient alone. The token from
 * the email proves *which* request is being answered; being signed in as a
 * member of that workspace proves *who* is answering. A forwarded email
 * therefore authorises nothing on its own, which matters because the email
 * lands in an inbox and inboxes get forwarded.
 *
 * Deliberately not reachable by an administrator acting through impersonation:
 * the workspace context is resolved the ordinary way, so an impersonated
 * session resolves to the workspace being impersonated - and the write that
 * approving performs is refused by the proxy in read and sandbox tiers anyway.
 * An administrator cannot approve their own request.
 */
const schema = z.object({ decision: z.enum(["approve", "decline"]) });

async function loadGrant(token: string, workspaceId: string) {
  const [grant] = await db
    .select()
    .from(impersonationGrants)
    .where(
      and(
        eq(impersonationGrants.token, token),
        // Scoped to the caller's own workspace, so a token belonging to some
        // other workspace is not merely unauthorised - it is not found.
        eq(impersonationGrants.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return grant ?? null;
}

export async function GET(_: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const { token } = await context.params;
    const workspace = await getWorkspaceContext();
    const grant = await loadGrant(token, workspace.workspaceId);
    if (!grant) {
      throw new AppError("REQUEST_NOT_FOUND", "Request not found.", 404);
    }

    const [owner] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, grant.workspaceId))
      .limit(1);

    return NextResponse.json({
      data: {
        adminEmail: grant.adminEmail,
        reason: grant.reason,
        status: grant.status,
        requestedAt: grant.requestedAt,
        expiresAt: grant.expiresAt,
        grantExpiresAt: grant.grantExpiresAt,
        workspaceName: owner?.name ?? "",
        expired: grant.expiresAt.getTime() < Date.now(),
        grantHours: GRANT_TTL_HOURS,
      },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const { token } = await context.params;
    const input = schema.parse(await request.json());
    const workspace = await getWorkspaceContext();

    // Only an owner decides. A member being asked to authorise access to their
    // colleagues' data is the wrong question put to the wrong person.
    if (workspace.role !== "owner") {
      throw new AppError(
        "OWNER_REQUIRED",
        "Only a workspace owner can answer this.",
        403,
      );
    }

    const grant = await loadGrant(token, workspace.workspaceId);
    if (!grant) {
      throw new AppError("REQUEST_NOT_FOUND", "Request not found.", 404);
    }
    if (grant.status !== "pending") {
      throw new AppError(
        "ALREADY_ANSWERED",
        `This request was already ${grant.status}.`,
        409,
      );
    }
    if (grant.expiresAt.getTime() < Date.now()) {
      throw new AppError(
        "REQUEST_EXPIRED",
        "This request has expired. Ask them to send a new one.",
        410,
      );
    }

    const approved = input.decision === "approve";
    const [updated] = await db
      .update(impersonationGrants)
      .set({
        status: approved ? "approved" : "declined",
        respondedAt: new Date(),
        respondedByEmail: workspace.email,
        grantExpiresAt: approved ? hoursFromNow(GRANT_TTL_HOURS) : null,
      })
      .where(eq(impersonationGrants.id, grant.id))
      .returning();

    // Under the customer's own workspace, so it appears in their activity - the
    // point being that a permission they gave is a thing they can look up
    // afterwards, not only something they remember agreeing to.
    await recordAudit({
      workspaceId: grant.workspaceId,
      actorEmail: workspace.email,
      action: approved
        ? "workspace.write_access_granted"
        : "workspace.write_access_declined",
      targetType: "workspace",
      targetId: grant.workspaceId,
      message: approved
        ? `${workspace.email} allowed ${grant.adminEmail} to make changes for ${GRANT_TTL_HOURS} hours`
        : `${workspace.email} declined ${grant.adminEmail}'s request to make changes`,
      metadata: {
        adminEmail: grant.adminEmail,
        reason: grant.reason,
        grantExpiresAt: updated.grantExpiresAt?.toISOString() ?? null,
      },
      requestId,
    });

    return NextResponse.json({ data: { grant: updated }, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/**
 * Withdrawing permission already given.
 *
 * Consent that cannot be taken back is not consent. Revoking does not end a
 * session that is already open - the cookie is signed and self-contained - but
 * that session is capped at an hour and no new one can be started, so the
 * exposure is bounded by the remainder of one short session rather than by the
 * grant's full window.
 */
export async function DELETE(_: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const { token } = await context.params;
    const workspace = await getWorkspaceContext();
    if (workspace.role !== "owner") {
      throw new AppError(
        "OWNER_REQUIRED",
        "Only a workspace owner can withdraw this.",
        403,
      );
    }

    const grant = await loadGrant(token, workspace.workspaceId);
    if (!grant) {
      throw new AppError("REQUEST_NOT_FOUND", "Request not found.", 404);
    }

    await db
      .update(impersonationGrants)
      .set({ status: "revoked", grantExpiresAt: null })
      .where(eq(impersonationGrants.id, grant.id));

    await recordAudit({
      workspaceId: grant.workspaceId,
      actorEmail: workspace.email,
      action: "workspace.write_access_revoked",
      targetType: "workspace",
      targetId: grant.workspaceId,
      message: `${workspace.email} withdrew ${grant.adminEmail}'s permission to make changes`,
      metadata: { adminEmail: grant.adminEmail },
      requestId,
    });

    return NextResponse.json({ data: { revoked: true }, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
