import "server-only";

import { db } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema";

type AuditEntry = {
  workspaceId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  message: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  requestId?: string | null;
};

export async function recordAudit(entry: AuditEntry) {
  await db.insert(auditLogs).values({
    workspaceId: entry.workspaceId,
    actorUserId: entry.actorUserId,
    actorEmail: entry.actorEmail?.toLowerCase(),
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    message: entry.message,
    metadata: entry.metadata ?? {},
    ipAddress: entry.ipAddress,
    requestId: entry.requestId,
  });
}

