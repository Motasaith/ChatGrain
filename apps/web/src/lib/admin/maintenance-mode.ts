import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { systemState } from "@/lib/db/schema";

/**
 * Maintenance mode: customers see a "back shortly" page, administrators carry
 * on as normal.
 *
 * Kept in `system_state` rather than an environment variable, because the
 * moment it is needed is the middle of a migration, and a switch that needs a
 * restart to flip is no use then. One primary-key read per dashboard request.
 *
 * It covers the dashboard only. The widget on customers' websites keeps
 * answering: their visitors did not choose the maintenance window, and an
 * agent that goes silent on somebody else's site reads as that site breaking.
 */

const KEY = "maintenance";

export type MaintenanceState = {
  enabled: boolean;
  message: string;
  since: string | null;
  by: string | null;
};

export const DEFAULT_MAINTENANCE_MESSAGE =
  "ChatGrain is being updated. Your agents are still answering visitors; the dashboard will be back in a few minutes.";

export async function getMaintenanceState(): Promise<MaintenanceState> {
  try {
    const [row] = await db
      .select({ value: systemState.value, updatedAt: systemState.updatedAt })
      .from(systemState)
      .where(eq(systemState.key, KEY))
      .limit(1);
    const value = (row?.value ?? {}) as Partial<MaintenanceState>;
    return {
      enabled: value.enabled === true,
      message: value.message?.trim() || DEFAULT_MAINTENANCE_MESSAGE,
      since: value.enabled && row ? row.updatedAt.toISOString() : null,
      by: value.enabled ? (value.by ?? null) : null,
    };
  } catch {
    // An unreadable flag means "not in maintenance". Failing closed would lock
    // every customer out of the dashboard whenever the database hiccups.
    return { enabled: false, message: DEFAULT_MAINTENANCE_MESSAGE, since: null, by: null };
  }
}

export async function setMaintenanceState(input: {
  enabled: boolean;
  message?: string;
  by: string;
}) {
  const value = {
    enabled: input.enabled,
    message: input.message?.trim() || DEFAULT_MAINTENANCE_MESSAGE,
    by: input.by,
  };
  await db
    .insert(systemState)
    .values({ key: KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value, updatedAt: new Date() },
    });
}
