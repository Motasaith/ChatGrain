import { and, desc, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminIdentity } from "@/lib/auth/session";
import {
  GRANT_TTL_HOURS,
  REQUEST_TTL_HOURS,
  activeGrant,
  grantRequestMessage,
  grantToken,
  hoursFromNow,
} from "@/lib/auth/impersonation-grant";
import { db } from "@/lib/db/client";
import {
  impersonationGrants,
  memberships,
  users,
  workspaces,
} from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";
import { mailerConfigured, sendSupportEmail } from "@/lib/support/mailer";

/**
 * Asking a customer for permission to change their account.
 *
 * The reason is required and has a floor on its length, which is unusual in
 * this codebase - most optional reasons are optional because a mandatory field
 * only ever collects the word "support". This one is different: it is not for
 * the audit trail, it is the entire basis on which somebody who is not a
 * developer decides whether to let a stranger edit their agent. "Fixing an
 * issue" is not something a person can consent to.
 */
const schema = z.object({
  workspaceId: z.uuid(),
  reason: z.string().trim().min(20).max(500),
});

/** Where the customer goes to answer. */
function approvalUrl(token: string) {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ??
    "http://localhost:3000";
  return `${base}/dashboard/permissions/${token}`;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const input = schema.parse(await request.json());

    const [workspace] = await db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (!workspace) {
      throw new AppError("WORKSPACE_NOT_FOUND", "Workspace not found.", 404);
    }

    // Already allowed: say so rather than sending the customer a second email
    // asking for something they have given.
    const existing = await activeGrant(workspace.id, identity.email);
    if (existing) {
      return NextResponse.json({
        data: {
          status: "already_granted",
          grantExpiresAt: existing.grantExpiresAt,
        },
        requestId,
      });
    }

    // One live request at a time per administrator per workspace. Pressing the
    // button twice should not put two identical decisions in front of somebody.
    const [pending] = await db
      .select()
      .from(impersonationGrants)
      .where(
        and(
          eq(impersonationGrants.workspaceId, workspace.id),
          eq(impersonationGrants.adminEmail, identity.email),
          eq(impersonationGrants.status, "pending"),
          gt(impersonationGrants.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(impersonationGrants.requestedAt))
      .limit(1);

    const grant =
      pending ??
      (
        await db
          .insert(impersonationGrants)
          .values({
            workspaceId: workspace.id,
            adminEmail: identity.email,
            reason: input.reason,
            token: grantToken(),
            expiresAt: hoursFromNow(REQUEST_TTL_HOURS),
          })
          .returning()
      )[0];

    // Owners first: the person who can answer for the workspace is the person
    // who owns it, and a member being asked to authorise access to their
    // colleagues' data is the wrong question put to the wrong person.
    const recipients = await db
      .select({ email: users.email, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, workspace.id));
    const owners = recipients.filter((row) => row.role === "owner");
    const audience = (owners.length ? owners : recipients)
      .map((row) => row.email)
      .filter(Boolean);

    const message = grantRequestMessage({
      workspaceName: workspace.name,
      adminEmail: identity.email,
      reason: input.reason,
      approveUrl: approvalUrl(grant.token),
      expiresAt: grant.expiresAt,
    });

    // An installation with no outbound mail is the normal self-hosted case, and
    // telling an administrator "email is not configured" while offering nothing
    // else would leave them doing the thing this exists to prevent: changing an
    // account and mentioning it afterwards. So the text comes back either way,
    // to be pasted into whatever they already talk to the customer through.
    let delivered = false;
    if (mailerConfigured() && audience.length) {
      const results = await Promise.all(
        audience.map((to) =>
          sendSupportEmail({
            to,
            subject: message.subject,
            text: message.body,
            replyTo: identity.email,
          }),
        ),
      );
      delivered = results.some(Boolean);
    }

    await recordAudit({
      workspaceId: workspace.id,
      actorEmail: identity.email,
      action: "admin.write_access_requested",
      targetType: "workspace",
      targetId: workspace.id,
      message: `${identity.email} asked ${workspace.name} for permission to make changes`,
      metadata: {
        reason: input.reason,
        delivered,
        recipients: audience.length,
        expiresAt: grant.expiresAt.toISOString(),
        reused: Boolean(pending),
      },
      requestId,
    });

    return NextResponse.json({
      data: {
        status: pending ? "already_pending" : "requested",
        delivered,
        recipients: audience,
        approveUrl: approvalUrl(grant.token),
        message,
        expiresAt: grant.expiresAt,
        grantHours: GRANT_TTL_HOURS,
      },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
