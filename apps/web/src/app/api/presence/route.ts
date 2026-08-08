import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { operatorPresence } from "@/lib/db/schema";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { errorResponse } from "@/lib/http/errors";

/**
 * Heartbeat from an operator with the dashboard open.
 *
 * Called on a timer by the app shell. Presence is observed rather than
 * declared, so a widget never promises a live person because someone forgot to
 * flip an "available" switch off on Friday.
 */
export async function POST() {
  const requestId = crypto.randomUUID();
  try {
    const context = await getWorkspaceContext();
    await db
      .insert(operatorPresence)
      .values({
        workspaceId: context.workspaceId,
        userId: context.userId,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [operatorPresence.workspaceId, operatorPresence.userId],
        set: { lastSeenAt: new Date() },
      });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
