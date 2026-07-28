import "server-only";

import { createHash } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships, users, workspaces } from "@/lib/db/schema";
import { getCurrentIdentity, isAdminEmail } from "./session";

export async function getWorkspaceContext() {
  const identity = await getCurrentIdentity();
  const admin = isAdminEmail(identity.email);
  const existing = await db
    .select({
      userId: users.id,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      role: memberships.role,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(
      and(
        eq(users.externalId, identity.externalId),
        eq(memberships.role, "owner"),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const shouldRefresh =
      Date.now() - existing[0].lastSeenAt.getTime() > 5 * 60 * 1000;
    if (shouldRefresh || admin) {
      await db
        .update(users)
        .set({
          lastSeenAt: new Date(),
          retentionExempt: admin,
          email: identity.email,
          name: identity.name,
          avatarUrl: identity.avatarUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing[0].userId));
    }
    return { ...identity, ...existing[0], isAdmin: admin };
  }

  return db.transaction(async (tx) => {
    const [knownUser] = await tx
      .select()
      .from(users)
      .where(
        or(
          eq(users.externalId, identity.externalId),
          eq(users.email, identity.email),
        ),
      )
      .limit(1);
    const [user] = knownUser
      ? await tx
          .update(users)
          .set({
            externalId: identity.externalId,
            email: identity.email,
            name: identity.name,
            avatarUrl: identity.avatarUrl,
            lastSeenAt: new Date(),
            retentionExempt: admin,
            updatedAt: new Date(),
          })
          .where(eq(users.id, knownUser.id))
          .returning()
      : await tx
          .insert(users)
          .values({
            externalId: identity.externalId,
            email: identity.email,
            name: identity.name,
            avatarUrl: identity.avatarUrl,
            lastSeenAt: new Date(),
            retentionExempt: admin,
          })
          .returning();

    const [knownMembership] = await tx
      .select({
        workspaceId: workspaces.id,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, user.id))
      .limit(1);
    if (knownMembership) {
      return {
        ...identity,
        userId: user.id,
        ...knownMembership,
        isAdmin: admin,
      };
    }

    const stableSlug =
      process.env.AUTH_PROVIDER === "clerk"
        ? `workspace-${createHash("sha256")
            .update(identity.externalId)
            .digest("hex")
            .slice(0, 16)}`
        : "local-workspace";
    const existingWorkspace = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, stableSlug))
      .limit(1);
    const workspace =
      existingWorkspace[0] ??
      (
        await tx
          .insert(workspaces)
          .values({
            name: `${identity.name}'s workspace`,
            slug: stableSlug,
          })
          .returning()
      )[0];

    await tx
      .insert(memberships)
      .values({ userId: user.id, workspaceId: workspace.id, role: "owner" })
      .onConflictDoNothing();

    return {
      ...identity,
      userId: user.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      role: "owner",
      isAdmin: admin,
    };
  });
}
