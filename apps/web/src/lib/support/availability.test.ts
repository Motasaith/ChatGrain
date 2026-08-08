import { describe, expect, it } from "vitest";
import { PRESENCE_TTL_MS, resolveAvailability } from "./availability";
import type { BusinessHours } from "./business-hours";

const hours: BusinessHours = {
  timezone: "UTC",
  days: [[], [{ start: 540, end: 1020 }], [], [], [], [], []],
};
// Monday 12:00 UTC, inside the window.
const insideHours = new Date("2026-08-10T12:00:00Z");

describe("resolveAvailability", () => {
  it("is live only when open and someone is there", () => {
    const result = resolveAvailability({
      businessHours: hours,
      lastOperatorSeenAt: new Date(insideHours.getTime() - 10_000),
      now: insideHours,
    });
    expect(result).toEqual({ live: true, reason: "live" });
  });

  it("is not live when nobody is at the desk during opening hours", () => {
    // The case an hours-only check gets wrong: it would promise a person.
    const result = resolveAvailability({
      businessHours: hours,
      lastOperatorSeenAt: null,
      now: insideHours,
    });
    expect(result.live).toBe(false);
    expect(result.reason).toBe("nobody_available");
  });

  it("treats a stale heartbeat as absent", () => {
    const result = resolveAvailability({
      businessHours: hours,
      lastOperatorSeenAt: new Date(insideHours.getTime() - PRESENCE_TTL_MS - 1),
      now: insideHours,
    });
    expect(result.reason).toBe("nobody_available");
  });

  it("reports the next opening when shut", () => {
    // Sunday: closed, next opening is Monday 09:00 UTC.
    const result = resolveAvailability({
      businessHours: hours,
      lastOperatorSeenAt: new Date("2026-08-09T12:00:00Z"),
      now: new Date("2026-08-09T12:00:00Z"),
    });
    expect(result.reason).toBe("outside_hours");
    expect(result.nextOpenAt).toContain("2026-08-10T09:00");
  });

  it("distinguishes 'no hours set' from 'currently shut'", () => {
    // Without this the widget would tell visitors to come back during hours
    // that were never configured.
    const result = resolveAvailability({
      businessHours: null,
      lastOperatorSeenAt: new Date(),
      now: insideHours,
    });
    expect(result.reason).toBe("not_configured");
    expect(result.nextOpenAt).toBeUndefined();
  });

  it("never claims live when an operator is present but the office is shut", () => {
    const result = resolveAvailability({
      businessHours: hours,
      lastOperatorSeenAt: new Date("2026-08-09T12:00:00Z"),
      now: new Date("2026-08-09T12:00:00Z"),
    });
    expect(result.live).toBe(false);
  });
});
