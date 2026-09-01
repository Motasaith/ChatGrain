import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAdminIdentity,
  requireSuperAdminIdentity,
} from "@/lib/auth/session";
import {
  PLATFORM_ROLES,
  roleIsFixedByEnvironment,
  type PlatformRole,
} from "@/lib/auth/roles";
import { db } from "@/lib/db/client";
import { memberships, users, workspaces } from "@/lib/db/schema";
import { AppError, errorResponse, readJson } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";

type RouteContext = { params: Promise<{ userId: string }> };

const patchSchema = z.object({
  /** Exempt from the inactivity retention sweep. */
  retentionExempt: z.boolean().optional(),
  /** member | admin | superadmin. Only a super administrator may set this. */
  platformRole: z.enum(PLATFORM_ROLES as unknown as [string, ...string[]])
    .optional(),
});

async function loadUser(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      externalId: users.externalId,
      platformRole: users.platformRole,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new AppError("USER_NOT_FOUND", "User not found.", 404);
  return user;
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    // The body is parsed before authorising, because which authorisation
    // applies depends on what is being asked for: changing a role is a
    // different power from being an administrator, and everything else on this
    // route stays open to any of them. Parsing is not a privileged act.
    const input = patchSchema.parse(await readJson(request, 2_000));
    const identity =
      input.platformRole !== undefined
        ? await requireSuperAdminIdentity()
        : await requireAdminIdentity();
    const { userId } = await context.params;
    const user = await loadUser(userId);

    if (input.retentionExempt !== undefined) {
      await db
        .update(users)
        .set({ retentionExempt: input.retentionExempt, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await recordAudit({
        action: "admin.user_retention_changed",
        actorEmail: identity.email,
        targetType: "user",
        targetId: userId,
        message: `${input.retentionExempt ? "Protected" : "Unprotected"} ${user.email} from inactivity cleanup`,
        metadata: { email: user.email, exempt: input.retentionExempt },
      });
    }

    if (input.platformRole !== undefined) {
      const next = input.platformRole as PlatformRole;

      // Refused rather than allowed to succeed pointlessly. Writing "member"
      // into the row of somebody listed in ADMIN_EMAILS changes nothing about
      // what they can do, and would leave an administrator believing they had
      // revoked access they had not.
      if (roleIsFixedByEnvironment(user.email)) {
        throw new AppError(
          "ROLE_FIXED_IN_ENV",
          `${user.email} is listed in ADMIN_EMAILS, so their role is set by ` +
            "configuration and cannot be changed here. Remove them from that " +
            "list first if you mean to demote them.",
          409,
        );
      }

      // A super administrator demoting themselves is almost always a misclick,
      // and the recovery - editing an env file on the server and restarting -
      // is exactly what this feature exists to avoid.
      if (
        user.email.toLowerCase() === identity.email.toLowerCase() &&
        next !== "superadmin"
      ) {
        throw new AppError(
          "CANNOT_DEMOTE_SELF",
          "You cannot lower your own role. Ask another super administrator.",
          409,
        );
      }

      if (next !== user.platformRole) {
        await db
          .update(users)
          .set({ platformRole: next, updatedAt: new Date() })
          .where(eq(users.id, userId));
        await recordAudit({
          action: "admin.user_role_changed",
          actorEmail: identity.email,
          targetType: "user",
          targetId: userId,
          message: `${identity.email} changed ${user.email} from ${user.platformRole} to ${next}`,
          metadata: { email: user.email, from: user.platformRole, to: next },
        });
      }
    }

    return NextResponse.json({ data: { id: userId }, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const { userId } = await context.params;
    const user = await loadUser(userId);

    // An installation must not be able to delete its own way in. Addresses
    // fixed by the environment are the recovery path and are refused outright;
    // an administrator granted from the dashboard has to be demoted first,
    // which is a deliberate second step rather than a second click.
    if (roleIsFixedByEnvironment(user.email)) {
      throw new AppError(
        "ADMIN_NOT_DELETABLE",
        "This account is listed in ADMIN_EMAILS and cannot be deleted here. Remove the address from that list first.",
        409,
      );
    }
    if (user.platformRole !== "member") {
      throw new AppError(
        "ADMIN_NOT_DELETABLE",
        `${user.email} is a ${user.platformRole}. Lower their role to member before deleting them.`,
        409,
      );
    }

    await db.transaction(async (tx) => {
      // Workspaces the user owns go with them; agents, sources, chunks, and
      // conversations cascade from there.
      const owned = await tx
        .select({ workspaceId: memberships.workspaceId })
        .from(memberships)
        .where(eq(memberships.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
      for (const row of owned) {
        const remaining = await tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(eq(memberships.workspaceId, row.workspaceId))
          .limit(1);
        if (!remaining.length) {
          await tx.delete(workspaces).where(eq(workspaces.id, row.workspaceId));
        }
      }
    });

    await recordAudit({
      action: "admin.user_deleted",
      actorEmail: identity.email,
      targetType: "user",
      targetId: userId,
      message: `Deleted user ${user.email} and any workspace left without members`,
      metadata: { email: user.email, externalId: user.externalId },
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
