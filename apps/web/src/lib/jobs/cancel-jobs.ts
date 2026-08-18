import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agents,
  crawlJobs,
  documents,
  sources,
  systemState,
} from "@/lib/db/schema";

/**
 * The workers currently beating, by id.
 *
 * Asking only whether *some* worker is alive is not enough once more than one
 * exists - which happens by accident whenever a developer runs `npm run dev`
 * against the deployed database. A job orphaned by a worker that died then
 * looks healthy because a different worker is still beating, and its stop
 * request waits for a process that is never coming back.
 *
 * The heartbeat runs on its own timer, independent of job processing, so a
 * missing beat means gone rather than busy.
 */
async function liveWorkerIds() {
  const beats = await db
    .select({ key: systemState.key, updatedAt: systemState.updatedAt })
    .from(systemState)
    .where(like(systemState.key, "worker:%"));
  return new Set(
    beats
      .filter((beat) => Date.now() - beat.updatedAt.getTime() < 60_000)
      .map((beat) => beat.key.slice("worker:".length)),
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
  const live = await liveWorkerIds();

  // Only a job held by a worker that is still beating has to wait for it.
  // Anything queued has no owner, and anything held by a departed worker has
  // lost the only process that could have read its stop flag.
  const held = await db
    .select({ id: crawlJobs.id, lockedBy: crawlJobs.lockedBy })
    .from(crawlJobs)
    .where(
      and(inArray(crawlJobs.id, jobIds), eq(crawlJobs.status, "running")),
    );
  const abandoned = held
    .filter((job) => !job.lockedBy || !live.has(job.lockedBy))
    .map((job) => job.id);

  const closeable = and(
    inArray(crawlJobs.id, jobIds),
    abandoned.length
      ? or(
          eq(crawlJobs.status, "queued"),
          inArray(crawlJobs.id, abandoned),
        )
      : eq(crawlJobs.status, "queued"),
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
