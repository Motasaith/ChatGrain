import "server-only";

import { createHash } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships, users, workspaces } from "@/lib/db/schema";
import { getCurrentIdentity, isAdminEmail } from "./session";
import { readImpersonation } from "./impersonation";

/**
 * Present on every path, so the field exists whether or not anyone is
 * impersonating.
 *
 * Without it the return type is a union in which only one branch carries
 * `impersonating`, and reading it anywhere else is a type error - which pushes
 * callers towards a cast, and a cast is exactly the wrong instinct for a field
 * that decides whose data is on screen.
 */
const NOT_IMPERSONATING = { impersonating: undefined as Impersonating };

type Impersonating =
  | {
      workspaceName: string;
      adminEmail: string;
      canWrite: boolean;
      expiresAt: number;
    }
  | undefined;

export async function getWorkspaceContext() {
  const identity = await getCurrentIdentity();
  const admin = isAdminEmail(identity.email);

  // An administrator standing where a customer is standing.
  //
  // Checked before the caller's own workspace is resolved, and only for an
  // administrator - the cookie is signed, but re-checking the email means a
  // leaked cookie is still useless to anyone else, and it means revoking
  // someone's administrator status revokes this with it.
  //
  // The identity underneath does not change. `isAdmin` stays true and
  // `identity.email` remains the administrator's, so an audit entry written
  // during impersonation still names who actually acted. Only the workspace
  // moves.
  if (admin) {
    const acting = await readImpersonation();
    if (acting) {
      const [target] = await db
        .select({
          workspaceId: workspaces.id,
          workspaceName: workspaces.name,
          workspaceSlug: workspaces.slug,
          workspacePageLimit: workspaces.pageLimit,
          workspaceSuspendedAt: workspaces.suspendedAt,
        })
        .from(workspaces)
        .where(eq(workspaces.id, acting.workspaceId))
        .limit(1);
      if (target) {
        return {
          ...identity,
          ...target,
          // No membership row is invented. The administrator is not an owner of
          // this workspace and nothing should later believe they are.
          userId: "",
          role: "owner" as const,
          lastSeenAt: new Date(),
          isAdmin: true,
          impersonating: {
            workspaceName: target.workspaceName,
            adminEmail: acting.adminEmail,
            canWrite: acting.canWrite,
            expiresAt: acting.expiresAt,
          },
        };
      }
    }
  }
  const existing = await db
    .select({
      userId: users.id,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      // Carried on the context because everything that needs them already has
      // it, and the alternative is a second query on every request that cares.
      workspacePageLimit: workspaces.pageLimit,
      workspaceSuspendedAt: workspaces.suspendedAt,
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
    return { ...identity, ...existing[0], isAdmin: admin, ...NOT_IMPERSONATING };
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
        workspacePageLimit: null as number | null,
        workspaceSuspendedAt: null as Date | null,
        isAdmin: admin,
        ...NOT_IMPERSONATING,
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
      workspacePageLimit: null as number | null,
      workspaceSuspendedAt: null as Date | null,
      role: "owner",
      isAdmin: admin,
      ...NOT_IMPERSONATING,
    };
  });
}
