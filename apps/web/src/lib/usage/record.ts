import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workspaceUsage } from "@/lib/db/schema";
import { logger } from "@/lib/observability/logger";

export type UsageKind = "generation" | "embedding" | "speech";

/**
 * The UTC day, as text.
 *
 * Text rather than a date column so a rollup never depends on the server's
 * timezone: two workers in different regions must agree on which day a call
 * belongs to, and "whatever the process thinks midnight is" does not.
 */
export function usageDay(at = new Date()) {
  return at.toISOString().slice(0, 10);
}

/**
 * Counts a call that cost money.
 *
 * Never throws and never blocks anything real. This runs on the path that
 * answers a customer's question and on the path that indexes their site, and a
 * failure to write a statistic must not fail either. A missed count is a
 * slightly wrong number on an administrator's screen; a thrown error here is a
 * customer not getting an answer.
 *
 * Aggregated on write rather than at read time, so the table stays one row per
 * workspace per day per kind however many calls there are - which for a large
 * crawl is tens of thousands.
 */
export async function recordUsage(
  workspaceId: string | null | undefined,
  kind: UsageKind,
  { calls = 1, units = 0 }: { calls?: number; units?: number } = {},
) {
  if (!workspaceId) return;
  try {
    await db
      .insert(workspaceUsage)
      .values({ workspaceId, day: usageDay(), kind, calls, units })
      .onConflictDoUpdate({
        target: [
          workspaceUsage.workspaceId,
          workspaceUsage.day,
          workspaceUsage.kind,
        ],
        set: {
          calls: sql`${workspaceUsage.calls} + ${calls}`,
          units: sql`${workspaceUsage.units} + ${units}`,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    logger.warn({ error, workspaceId, kind }, "Usage not recorded");
  }
}
