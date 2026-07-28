import "server-only";

import { and, count, eq, lt, notInArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  auditLogs,
  memberships,
  systemLogs,
  systemState,
  users,
  workspaces,
} from "@/lib/db/schema";
import { getAdminEmails } from "@/lib/auth/session";
import { recordSystemLog } from "@/lib/observability/system-log";

type CleanupResult = {
  dryRun: boolean;
  retentionDays: number;
  cutoff: string;
  matchedUsers: number;
  deletedUsers: number;
  deletedWorkspaces: number;
  clerkUsersDeleted: number;
  expiredAuditLogs: number;
  expiredSystemLogs: number;
  deletedAuditLogs: number;
  deletedSystemLogs: number;
  candidates: Array<{ id: string; email: string; lastSeenAt: string }>;
};

function retentionDays() {
  const configured = Number(process.env.INACTIVE_USER_RETENTION_DAYS ?? 30);
  return Number.isFinite(configured)
    ? Math.min(3_650, Math.max(7, Math.trunc(configured)))
    : 30;
}

async function deleteClerkUsers(externalIds: string[]) {
  if (
    process.env.AUTH_PROVIDER !== "clerk" ||
    process.env.RETENTION_DELETE_CLERK_USERS !== "true" ||
    externalIds.length === 0
  ) {
    return 0;
  }

  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  let deleted = 0;
  for (const externalId of externalIds) {
    try {
      await client.users.deleteUser(externalId);
      deleted += 1;
    } catch (error) {
      await recordSystemLog("error", "Clerk retention deletion failed", {
        externalId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  return deleted;
}

export async function cleanupInactiveUsers({
  dryRun = false,
}: {
  dryRun?: boolean;
} = {}): Promise<CleanupResult> {
  const days = retentionDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const adminEmails = [...getAdminEmails()];
  const conditions = [
    lt(users.lastSeenAt, cutoff),
    eq(users.retentionExempt, false),
  ];
  if (adminEmails.length) {
    conditions.push(notInArray(users.email, adminEmails));
  }

  const candidates = await db
    .select({
      id: users.id,
      externalId: users.externalId,
      email: users.email,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .where(and(...conditions))
    .limit(500);

  const result: CleanupResult = {
    dryRun,
    retentionDays: days,
    cutoff: cutoff.toISOString(),
    matchedUsers: candidates.length,
    deletedUsers: 0,
    deletedWorkspaces: 0,
    clerkUsersDeleted: 0,
    expiredAuditLogs: 0,
    expiredSystemLogs: 0,
    deletedAuditLogs: 0,
    deletedSystemLogs: 0,
    candidates: candidates.slice(0, 50).map((user) => ({
      id: user.id,
      email: user.email,
      lastSeenAt: user.lastSeenAt.toISOString(),
    })),
  };
  const auditCutoff = new Date(
    Date.now() -
      Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 180) *
        24 *
        60 *
        60 *
        1000,
  );
  const systemLogCutoff = new Date(
    Date.now() -
      Number(process.env.SYSTEM_LOG_RETENTION_DAYS ?? 30) *
        24 *
        60 *
        60 *
        1000,
  );
  const [expiredAudit, expiredSystem] = await Promise.all([
    db
      .select({ count: count(auditLogs.id) })
      .from(auditLogs)
      .where(lt(auditLogs.createdAt, auditCutoff)),
    db
      .select({ count: count(systemLogs.id) })
      .from(systemLogs)
      .where(lt(systemLogs.createdAt, systemLogCutoff)),
  ]);
  result.expiredAuditLogs = Number(expiredAudit[0]?.count ?? 0);
  result.expiredSystemLogs = Number(expiredSystem[0]?.count ?? 0);
  if (dryRun) return result;

  const deletedExternalIds: string[] = [];
  await db.transaction(async (tx) => {
    for (const candidate of candidates) {
      const owned = await tx
        .select({ workspaceId: memberships.workspaceId })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, candidate.id),
            eq(memberships.role, "owner"),
          ),
        );

      for (const ownedWorkspace of owned) {
        const [membershipCount] = await tx
          .select({ count: count(memberships.userId) })
          .from(memberships)
          .where(eq(memberships.workspaceId, ownedWorkspace.workspaceId));
        if (Number(membershipCount?.count ?? 0) === 1) {
          await tx
            .delete(workspaces)
            .where(eq(workspaces.id, ownedWorkspace.workspaceId));
          result.deletedWorkspaces += 1;
        }
      }

      await tx.delete(users).where(eq(users.id, candidate.id));
      result.deletedUsers += 1;
      if (candidate.externalId) deletedExternalIds.push(candidate.externalId);
    }

    result.deletedAuditLogs = (
      await tx
        .delete(auditLogs)
        .where(lt(auditLogs.createdAt, auditCutoff))
        .returning({ id: auditLogs.id })
    ).length;
    result.deletedSystemLogs = (
      await tx
        .delete(systemLogs)
        .where(lt(systemLogs.createdAt, systemLogCutoff))
        .returning({ id: systemLogs.id })
    ).length;

    await tx
      .insert(systemState)
      .values({
        key: "retention",
        value: {
          ranAt: new Date().toISOString(),
          deletedUsers: result.deletedUsers,
          deletedWorkspaces: result.deletedWorkspaces,
          deletedAuditLogs: result.deletedAuditLogs,
          deletedSystemLogs: result.deletedSystemLogs,
          retentionDays: days,
        },
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemState.key,
        set: {
          value: {
            ranAt: new Date().toISOString(),
            deletedUsers: result.deletedUsers,
            deletedWorkspaces: result.deletedWorkspaces,
            deletedAuditLogs: result.deletedAuditLogs,
            deletedSystemLogs: result.deletedSystemLogs,
            retentionDays: days,
          },
          updatedAt: new Date(),
        },
      });
  });

  result.clerkUsersDeleted = await deleteClerkUsers(deletedExternalIds);
  await recordSystemLog("info", "Inactive user retention completed", {
    ...result,
    candidates: undefined,
  });
  return result;
}
