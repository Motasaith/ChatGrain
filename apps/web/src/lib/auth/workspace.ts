import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships, users, workspaces } from "@/lib/db/schema";
import { getCurrentIdentity } from "./session";

export async function getWorkspaceContext() {
  const identity = await getCurrentIdentity();
  const existing = await db
    .select({
      userId: users.id,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      role: memberships.role,
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

  if (existing[0]) return { ...identity, ...existing[0] };

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        externalId: identity.externalId,
        email: identity.email,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
      })
      .onConflictDoUpdate({
        target: users.externalId,
        set: {
          email: identity.email,
          name: identity.name,
          updatedAt: new Date(),
        },
      })
      .returning();

    const existingWorkspace = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, "local-workspace"))
      .limit(1);
    const workspace =
      existingWorkspace[0] ??
      (
        await tx
          .insert(workspaces)
          .values({ name: "My workspace", slug: "local-workspace" })
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
    };
  });
}
