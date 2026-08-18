import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agents,
  crawlJobs,
  documents,
  sources,
  systemState,
} from "@/lib/db/schema";

/**
 * Whether a worker is present to act on a stop request.
 *
 * The heartbeat runs on its own timer, independent of whatever job is being
 * processed, so a stale one means the process is gone rather than merely busy.
 * Without this a job claimed by a worker that later died stays "Stopping…"
 * forever: the flag is set and nobody is left to read it.
 */
async function workerIsAlive() {
  const [beat] = await db
    .select({ updatedAt: systemState.updatedAt })
    .from(systemState)
    .where(eq(systemState.key, "worker"))
    .limit(1);
  return Boolean(
    beat?.updatedAt && Date.now() - beat.updatedAt.getTime() < 60_000,
  );
}

/**
 * Stops jobs, closing out every one that can be closed immediately.
 *
 * Only a job actually being processed has to wait for its worker. A queued job
 * has no owner, so flagging it and waiting means the operator watches
 * "Stopping…" until the worker finishes whatever it is doing first - which for
 * a slow embedding run is many minutes for something that could have ended at
 * once.
 *
 * Returns the ids still being processed, which are the only ones the caller
 * should describe as stopping.
 */
export async function cancelJobs(jobIds: string[]) {
  if (!jobIds.length) return { cancelled: [] as string[], stopping: [] as string[] };
  const alive = await workerIsAlive();

  // With no worker running, even a claimed job is abandoned, so nothing has to
  // be left pending.
  const closeable = alive
    ? and(inArray(crawlJobs.id, jobIds), eq(crawlJobs.status, "queued"))
    : and(
        inArray(crawlJobs.id, jobIds),
        inArray(crawlJobs.status, ["queued", "running"]),
      );

  const cancelled = await db
    .update(crawlJobs)
    .set({
      status: "cancelled",
      cancelRequestedAt: new Date(),
      errorCode: "CANCELLED",
      errorMessage: "Stopped before any data was indexed.",
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(closeable)
    .returning({ id: crawlJobs.id, sourceId: crawlJobs.sourceId });

  // Anything left is genuinely mid-flight; the worker unwinds it at its next
  // checkpoint.
  const stopping = await db
    .update(crawlJobs)
    .set({ cancelRequestedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        inArray(crawlJobs.id, jobIds),
        inArray(crawlJobs.status, ["queued", "running"]),
      ),
    )
    .returning({ id: crawlJobs.id });

  for (const job of cancelled) {
    // The rule the worker applies too: a source that never finished indexing
    // has nothing to show, and listing it promises content the agent cannot
    // answer from. One that already has documents keeps them.
    const [indexed] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(documents)
      .where(eq(documents.sourceId, job.sourceId));
    if (indexed?.value) {
      await db
        .update(sources)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(sources.id, job.sourceId));
    } else {
      await db.delete(sources).where(eq(sources.id, job.sourceId));
    }
  }

  // An agent left "training" with nothing running looks permanently stuck.
  const [remaining] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(crawlJobs)
    .where(inArray(crawlJobs.status, ["queued", "running"]));
  if (!remaining?.value) {
    await db
      .update(agents)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(agents.status, "training"));
  }

  return {
    cancelled: cancelled.map((job) => job.id),
    stopping: stopping.map((job) => job.id),
  };
}
