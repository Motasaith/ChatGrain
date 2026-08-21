import { describe, expect, it } from "vitest";
import {
  heartbeatGraceMs,
  holderIsAlive,
  secondsUntilReclaim,
  silentHolderGraceMs,
  staleScanMs,
  workerHeartbeatKey,
} from "./liveness";

const now = Date.parse("2026-08-21T12:00:00.000Z");
const ago = (ms: number) => new Date(now - ms);

describe("holderIsAlive", () => {
  it("treats a recent beat as alive", () => {
    expect(holderIsAlive(now, ago(1_000))).toBe(true);
  });

  it("tolerates a pause shorter than the grace window", () => {
    expect(holderIsAlive(now, ago(heartbeatGraceMs - 1))).toBe(true);
  });

  it("declares a holder gone once the grace window passes", () => {
    expect(holderIsAlive(now, ago(heartbeatGraceMs + 1))).toBe(false);
  });

  it("treats a holder that never beat as gone", () => {
    expect(holderIsAlive(now, null)).toBe(false);
  });

  // The regression this whole mechanism exists for: a worker killed seconds
  // into a job used to hold its lock for the rest of a fifteen-minute window.
  it("notices a death seconds after it happens", () => {
    expect(holderIsAlive(now, ago(60_000))).toBe(false);
  });
});

describe("secondsUntilReclaim", () => {
  it("counts down from the holder's last beat", () => {
    const seconds = secondsUntilReclaim({
      now,
      holderBeatAt: ago(10_000),
      lockedAt: ago(600_000),
    });
    expect(seconds).toBe(Math.ceil((heartbeatGraceMs + staleScanMs - 10_000) / 1000));
  });

  it("reaches zero once the job is already eligible", () => {
    expect(
      secondsUntilReclaim({
        now,
        holderBeatAt: ago(heartbeatGraceMs + staleScanMs + 5_000),
        lockedAt: ago(600_000),
      }),
    ).toBe(0);
  });

  it("never returns a negative wait", () => {
    expect(
      secondsUntilReclaim({
        now,
        holderBeatAt: ago(60 * 60 * 1000),
        lockedAt: ago(60 * 60 * 1000),
      }),
    ).toBe(0);
  });

  // A holder with no heartbeat row at all is the odd case, and it gets the
  // longer backstop rather than the six-missed-beats window.
  it("falls back to the lock time when there is no beat", () => {
    const seconds = secondsUntilReclaim({
      now,
      holderBeatAt: null,
      lockedAt: ago(30_000),
    });
    expect(seconds).toBe(
      Math.ceil((silentHolderGraceMs + staleScanMs - 30_000) / 1000),
    );
  });

  it("is bounded by the countdown the worker actually honours", () => {
    const seconds = secondsUntilReclaim({
      now,
      holderBeatAt: ago(0),
      lockedAt: ago(0),
    });
    // Whatever the UI promises must not be shorter than the worker's own rule,
    // or the countdown hits zero while nothing happens.
    expect(seconds).toBeGreaterThanOrEqual(heartbeatGraceMs / 1000);
  });
});

describe("workerHeartbeatKey", () => {
  // The per-worker key is what makes "is *this* job's holder alive" answerable;
  // the shared "worker" key is overwritten by any other running worker.
  it("namespaces a worker's own key", () => {
    expect(workerHeartbeatKey("worker_abc123")).toBe("worker:worker_abc123");
    expect(workerHeartbeatKey("worker_abc123")).not.toBe("worker");
  });
});
