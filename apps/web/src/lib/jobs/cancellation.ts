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
 * Reads the stop flag written by the cancel endpoint.
 *
 * A running job belongs to its worker, so a request cannot halt it directly.
 * Both processors call this between units of work, which means a stopped run
 * always unwinds from a point where nothing is half-written: neither writes
 * anything durable until its final transaction.
 */
export async function assertNotCancelled(jobId: string) {
  const [job] = await db
    .select({ cancelRequestedAt: crawlJobs.cancelRequestedAt })
    .from(crawlJobs)
    .where(eq(crawlJobs.id, jobId))
    .limit(1);
  if (job?.cancelRequestedAt) throw new JobCancelled();
}
