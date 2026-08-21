import { describe, expect, it } from "vitest";
import {
  JobCancelled,
  WorkerStopping,
  assertNotCancelled,
  beginWorkerShutdown,
  workerIsStopping,
} from "./cancellation";

// The shutdown flag is a one-way latch on the module, so this file owns it and
// asserts the pre-shutdown state before tripping it.
describe("worker shutdown", () => {
  it("starts up not stopping", () => {
    expect(workerIsStopping()).toBe(false);
  });

  it("latches once the signal handler asks it to", () => {
    beginWorkerShutdown();
    expect(workerIsStopping()).toBe(true);
  });

  it("unwinds a running job without touching the database", async () => {
    // The check happens before the query on purpose: a process being torn down
    // should not need a round trip to discover that it is being torn down.
    await expect(assertNotCancelled("any-job-id")).rejects.toBeInstanceOf(
      WorkerStopping,
    );
  });

  it("is not a cancellation", async () => {
    // The worker branches on these: a cancelled job is finished and must not
    // retry, a job interrupted by a restart goes back in the queue untouched.
    await expect(assertNotCancelled("any-job-id")).rejects.not.toBeInstanceOf(
      JobCancelled,
    );
  });
});
