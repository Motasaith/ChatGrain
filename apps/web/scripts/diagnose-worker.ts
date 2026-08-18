/**
 * Why nothing is being indexed.
 *
 * "Waiting for the worker" and a Stop button stuck on "Stopping…" have the same
 * three possible causes, and they are indistinguishable from the dashboard:
 * the worker is not running, it is running but wedged, or it is running and
 * simply busy with something slower than anyone expected. This reports which.
 *
 *   npm run diagnose:worker --workspace @docent/web
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { crawlJobs, sources, systemState } from "@/lib/db/schema";

function ago(value: Date | null | undefined) {
  if (!value) return "never";
  const seconds = Math.round((Date.now() - value.getTime()) / 1000);
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)}m ago`;
  return `${(seconds / 3600).toFixed(1)}h ago`;
}

async function main() {
  const [beat] = await db
    .select()
    .from(systemState)
    .where(eq(systemState.key, "worker"))
    .limit(1);

  const age = beat?.updatedAt
    ? Date.now() - beat.updatedAt.getTime()
    : Number.POSITIVE_INFINITY;

  console.log("=== worker ===");
  if (!beat) {
    console.log("  no heartbeat has ever been recorded.");
    console.log("  the worker has not started against this database.");
  } else {
    const value = beat.value as { workerId?: string; pid?: number } | null;
    console.log(`  last heartbeat : ${ago(beat.updatedAt)}`);
    console.log(`  worker id      : ${value?.workerId ?? "unknown"}`);
    console.log(`  pid            : ${value?.pid ?? "unknown"}`);
    console.log(
      `  verdict        : ${
        age < 15_000
          ? "alive"
          : age < 60_000
            ? "late - either restarting or blocked"
            : "not running"
      }`,
    );
  }

  console.log("\n=== jobs not finished ===");
  const open = await db
    .select({
      id: crawlJobs.id,
      status: crawlJobs.status,
      phase: crawlJobs.phase,
      progress: crawlJobs.progress,
      attempt: crawlJobs.attempt,
      lockedBy: crawlJobs.lockedBy,
      lockedAt: crawlJobs.lockedAt,
      cancelRequestedAt: crawlJobs.cancelRequestedAt,
      updatedAt: crawlJobs.updatedAt,
      errorMessage: crawlJobs.errorMessage,
      name: sources.name,
      type: sources.type,
    })
    .from(crawlJobs)
    .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
    .where(inArray(crawlJobs.status, ["queued", "running"]))
    .orderBy(desc(crawlJobs.updatedAt))
    .limit(20);

  if (!open.length) {
    console.log("  none. nothing is waiting, so the queue is not the problem.");
  }
  for (const job of open) {
    console.log(
      `  [${job.status}] ${job.type} "${job.name}" ${job.progress}% ${job.phase}`,
    );
    console.log(
      `      updated ${ago(job.updatedAt)} · attempt ${job.attempt}` +
        (job.lockedBy ? ` · held by ${job.lockedBy} since ${ago(job.lockedAt)}` : "") +
        (job.cancelRequestedAt ? ` · STOP requested ${ago(job.cancelRequestedAt)}` : ""),
    );
    if (job.errorMessage) console.log(`      last error: ${job.errorMessage}`);
    // A running job whose row has not moved is the signature of a worker that
    // died mid-job: the lock is still held, so nothing else will claim it.
    if (
      job.status === "running" &&
      Date.now() - job.updatedAt.getTime() > 120_000
    ) {
      console.log(
        "      ^ no progress for over two minutes. If the heartbeat above is" +
          " stale, this job is orphaned and will be requeued 15 minutes after" +
          " its lock was taken.",
      );
    }
  }

  console.log("\n=== recent outcomes ===");
  const recent = await db
    .select({
      status: crawlJobs.status,
      count: sql<number>`count(*)::int`,
    })
    .from(crawlJobs)
    .groupBy(crawlJobs.status);
  for (const row of recent) console.log(`  ${row.status}: ${row.count}`);

  process.exit(0);
}

main().catch((error) => {
  console.error("diagnose-worker failed:", error);
  process.exit(1);
});
