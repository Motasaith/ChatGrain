import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAdminIdentity } from "@/lib/auth/session";
import { readImpersonation } from "@/lib/auth/impersonation";
import {
  diffSnapshot,
  takeSnapshot,
  type WorkspaceSnapshot,
} from "@/lib/auth/workspace-snapshot";
import { db } from "@/lib/db/client";
import { adminSessions } from "@/lib/db/schema";
import { errorResponse } from "@/lib/http/errors";

/**
 * What this session has changed so far.
 *
 * Read on the way out, so the administrator decides about a named list rather
 * than about a vague "your changes". Somebody who spent twenty minutes in an
 * account cannot reliably remember everything they touched, and "keep or
 * discard?" with nothing named is a question that gets answered wrongly.
 *
 * Computed rather than tracked. Recording every write as it happened would mean
 * every route reporting into a session log, and would be wrong the first time
 * one of them forgot. Comparing the configuration against the copy taken on the
 * way in cannot miss anything, because it does not depend on anybody
 * remembering to report.
 */
export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    await requireAdminIdentity();
    const session = await readImpersonation();
    if (!session?.sessionId) {
      return NextResponse.json({ data: { changes: [] }, requestId });
    }

    const [row] = await db
      .select()
      .from(adminSessions)
      .where(eq(adminSessions.id, session.sessionId))
      .limit(1);
    if (!row || row.status !== "open") {
      return NextResponse.json({ data: { changes: [] }, requestId });
    }

    const after = await takeSnapshot(session.workspaceId);
    const changes = diffSnapshot(row.snapshot as WorkspaceSnapshot, after);

    return NextResponse.json({
      data: { changes, workspaceName: session.workspaceName },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
