import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminEmail, requireAdminIdentity } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { memberships, users, workspaces } from "@/lib/db/schema";
import { AppError, errorResponse, readJson } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";

type RouteContext = { params: Promise<{ userId: string }> };

const patchSchema = z.object({
  /** Exempt from the inactivity retention sweep. */
  retentionExempt: z.boolean(),
});

async function loadUser(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      externalId: users.externalId,
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
    const identity = await requireAdminIdentity();
    const { userId } = await context.params;
    const input = patchSchema.parse(await readJson(request, 2_000));
    const user = await loadUser(userId);

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

    // An administrator removing themselves would lock the installation out of
    // its own controls, and removing a fellow administrator is a decision that
    // belongs in configuration, not a button.
    if (isAdminEmail(user.email)) {
      throw new AppError(
        "ADMIN_NOT_DELETABLE",
        "Administrator accounts cannot be deleted here. Remove the address from ADMIN_EMAILS first.",
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
