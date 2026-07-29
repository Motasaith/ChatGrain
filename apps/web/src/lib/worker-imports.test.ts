import { describe, expect, it } from "vitest";

describe("standalone worker module graph", () => {
  it("loads worker-shared server modules outside the Next.js runtime", async () => {
    const [retention, systemLog] = await Promise.all([
      import("@/lib/admin/retention"),
      import("@/lib/observability/system-log"),
    ]);

    expect(retention.cleanupInactiveUsers).toBeTypeOf("function");
    expect(systemLog.recordSystemLog).toBeTypeOf("function");
  });
});
