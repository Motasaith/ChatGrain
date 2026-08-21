/**
 * Shared definition of when a worker counts as gone.
 *
 * Both the worker (deciding whether to reclaim someone else's job) and the
 * dashboard (telling an operator how long the wait will be) have to answer this
 * question, and they have to answer it the same way - a UI counting down to a
 * moment the worker disagrees with is worse than no countdown at all.
 */

export const workerHeartbeatIntervalMs = Math.max(
  2_000,
  Number(process.env.WORKER_HEARTBEAT_MS ?? 5_000),
);

/**
 * How long a job's holder can go silent before the job is treated as abandoned.
 *
 * Six missed beats, so an ordinary garbage-collection pause or one slow query
 * cannot trip it. This replaced a flat fifteen minutes measured from when the
 * lock was taken: a worker that died a second into a job used to leave it frozen
 * for the rest of that quarter hour, with nothing on screen but a progress bar
 * that had stopped moving.
 */
export const heartbeatGraceMs = Math.max(30_000, workerHeartbeatIntervalMs * 6);

/**
 * Backstop for a holder that never wrote a heartbeat at all. A worker beats once
 * before it claims anything, so this only comes up if the heartbeat row was
 * deleted or the lock was written by something that is not a worker.
 */
export const silentHolderGraceMs = 5 * 60 * 1000;

/** How often a worker looks for abandoned jobs. */
export const staleScanMs = 15_000;

/** The heartbeat key a worker writes under its own id. */
export function workerHeartbeatKey(workerId: string) {
  return `worker:${workerId}`;
}

/**
 * Seconds until an abandoned job becomes eligible for reclaim, or null if its
 * holder is still alive.
 *
 * The scan interval is added because eligibility is not the same as pickup: a
 * job that qualifies one second after a scan waits for the next one.
 */
export function secondsUntilReclaim(args: {
  now: number;
  holderBeatAt: Date | null;
  lockedAt: Date | null;
}): number | null {
  const { now, holderBeatAt, lockedAt } = args;
  const since = holderBeatAt
    ? now - holderBeatAt.getTime()
    : lockedAt
      ? now - lockedAt.getTime()
      : Number.POSITIVE_INFINITY;
  const grace = holderBeatAt ? heartbeatGraceMs : silentHolderGraceMs;
  if (since <= 0) return Math.ceil((grace + staleScanMs) / 1000);
  return Math.max(0, Math.ceil((grace + staleScanMs - since) / 1000));
}

/** Whether the process holding a job is still beating. */
export function holderIsAlive(now: number, holderBeatAt: Date | null) {
  return Boolean(holderBeatAt && now - holderBeatAt.getTime() <= heartbeatGraceMs);
}
