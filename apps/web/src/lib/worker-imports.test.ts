import { describe, expect, it } from "vitest";

describe("standalone worker module graph", () => {
  it("loads worker-shared server modules outside the Next.js runtime", async () => {
    const [retention, systemLog] = await Promise.all([
      import("@/lib/admin/retention"),
      import("@/lib/observability/system-log"),
    ]);

    expect(retention.cleanupInactiveUsers).toBeTypeOf("function");
    expect(systemLog.recordSystemLog).toBeTypeOf("function");
    // These pull in the database client and its dependencies. Cold-importing
    // that graph while the rest of the suite competes for CPU regularly passes
    // 5 seconds, which made this fail at random rather than on a real problem.
  }, 30_000);
});
