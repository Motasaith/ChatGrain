import { db } from "@/lib/db/client";
import { systemLogs } from "@/lib/db/schema";
import { logger } from "./logger";

type SystemLogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export async function recordSystemLog(
  level: SystemLogLevel,
  message: string,
  context: Record<string, unknown> = {},
  service = "docent-worker",
) {
  try {
    await db.insert(systemLogs).values({
      level,
      message: message.slice(0, 2_000),
      context,
      service,
    });
  } catch (error) {
    logger.warn({ error, message }, "Could not persist system log");
  }
}
