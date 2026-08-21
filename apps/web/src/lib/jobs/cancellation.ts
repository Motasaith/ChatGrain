import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { crawlJobs } from "@/lib/db/schema";

/**
 * Thrown when the operator presses stop.
 *
 * Handled separately from a failure by the worker: nothing went wrong, so the
 * job must not be retried and the agent must not be marked broken.
 */
export class JobCancelled extends Error {
  constructor() {
    super("Job cancelled by operator.");
    this.name = "JobCancelled";
  }
}

/**
 * Thrown when the worker process itself is going down mid-job.
 *
 * Deliberately not a JobCancelled and not a failure. Nobody asked for the work
 * to stop and nothing about the job went wrong - the machine asked the process
 * to exit. A deployment, a `pm2 restart`, or a file save under `tsx watch` all
 * land here. The job is handed straight back to the queue, so the next worker
 * picks it up in seconds instead of waiting out the abandonment timeout.
 */
export class WorkerStopping extends Error {
  constructor() {
    super("Worker is shutting down.");
    this.name = "WorkerStopping";
  }
}

/**
 * Set once, by the worker's signal handler.
 *
 * A module-level flag rather than a parameter threaded through every processor:
 * the checkpoints that need to read it are already calling into this module,
 * and the alternative is passing an abort signal through four call layers that
 * have no other use for it.
 */
let shuttingDown = false;

export function beginWorkerShutdown() {
  shuttingDown = true;
}

export function workerIsStopping() {
  return shuttingDown;
}

/**
 * Reads the stop flag written by the cancel endpoint.
 *
 * A running job belongs to its worker, so a request cannot halt it directly.
 * Both processors call this between units of work, which means a stopped run
 * always unwinds from a point where nothing is half-written: neither writes
 * anything durable until its final transaction.
 */
export async function assertNotCancelled(jobId: string) {
  // Checked before the query: a worker being torn down should not be waiting on
  // a round trip to the database to find out it is being torn down.
  if (shuttingDown) throw new WorkerStopping();
  const [job] = await db
    .select({ cancelRequestedAt: crawlJobs.cancelRequestedAt })
    .from(crawlJobs)
    .where(eq(crawlJobs.id, jobId))
    .limit(1);
  if (job?.cancelRequestedAt) throw new JobCancelled();
}
