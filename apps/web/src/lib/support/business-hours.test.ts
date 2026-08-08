import { describe, expect, it } from "vitest";
import {
  defaultBusinessHours,
  isWithinBusinessHours,
  minutesToTime,
  nextOpening,
  normaliseBusinessHours,
  timeToMinutes,
  type BusinessHours,
} from "./business-hours";

const karachi: BusinessHours = {
  timezone: "Asia/Karachi", // UTC+5, no daylight saving
  days: [
    [],
    [{ start: 540, end: 1020 }],
    [{ start: 540, end: 1020 }],
    [{ start: 540, end: 1020 }],
    [{ start: 540, end: 1020 }],
    [{ start: 540, end: 1020 }],
    [],
  ],
};

describe("isWithinBusinessHours", () => {
  it("uses the schedule's timezone, not the server's", () => {
    // 08:00 UTC on a Monday is 13:00 in Karachi: open.
    expect(isWithinBusinessHours(karachi, new Date("2026-08-10T08:00:00Z")))
      .toBe(true);
    // 03:00 UTC is 08:00 in Karachi: still shut.
    expect(isWithinBusinessHours(karachi, new Date("2026-08-10T03:00:00Z")))
      .toBe(false);
  });

  it("closes at the end of the range rather than including it", () => {
    // 17:00 Karachi exactly is closing time, not a final open minute.
    expect(isWithinBusinessHours(karachi, new Date("2026-08-10T12:00:00Z")))
      .toBe(false);
    expect(isWithinBusinessHours(karachi, new Date("2026-08-10T11:59:00Z")))
      .toBe(true);
  });

  it("respects the weekend", () => {
    // Saturday 2026-08-08, midday Karachi.
    expect(isWithinBusinessHours(karachi, new Date("2026-08-08T07:00:00Z")))
      .toBe(false);
  });

  it("handles a day rolling over in the schedule's zone", () => {
    // 20:00 UTC Sunday is 01:00 Monday in Karachi: Monday, but before opening.
    expect(isWithinBusinessHours(karachi, new Date("2026-08-09T20:00:00Z")))
      .toBe(false);
  });

  it("survives daylight saving in a zone that observes it", () => {
    const london: BusinessHours = {
      timezone: "Europe/London",
      days: [[], [{ start: 540, end: 1020 }], [], [], [], [], []],
    };
    // In August London is UTC+1, so 09:30 UTC is 10:30 local: open.
    expect(isWithinBusinessHours(london, new Date("2026-08-10T09:30:00Z")))
      .toBe(true);
    // 08:30 UTC is 09:30 local, also open; 07:30 UTC is 08:30 local, shut.
    expect(isWithinBusinessHours(london, new Date("2026-08-10T07:30:00Z")))
      .toBe(false);
  });

  it("is closed when unconfigured rather than claiming to be open", () => {
    expect(isWithinBusinessHours(null)).toBe(false);
    expect(isWithinBusinessHours(undefined)).toBe(false);
    expect(isWithinBusinessHours({ timezone: "UTC", days: [] })).toBe(false);
  });

  it("falls back to UTC for a nonsense timezone instead of throwing", () => {
    const broken: BusinessHours = { ...karachi, timezone: "Not/AZone" };
    expect(() => isWithinBusinessHours(broken, new Date())).not.toThrow();
  });

  it("defaults to weekdays only", () => {
    const hours = defaultBusinessHours("UTC");
    expect(hours.days[0]).toHaveLength(0);
    expect(hours.days[6]).toHaveLength(0);
    expect(hours.days[1]).toHaveLength(1);
  });
});

describe("nextOpening", () => {
  it("finds the next opening minute", () => {
    // Saturday: next opening is Monday 09:00 Karachi = 04:00 UTC.
    const opening = nextOpening(karachi, new Date("2026-08-08T07:00:00Z"));
    expect(opening?.toISOString()).toContain("2026-08-10T04:00");
  });

  it("returns null when nothing is ever open", () => {
    expect(nextOpening({ timezone: "UTC", days: [[], [], [], [], [], [], []] }))
      .toBeNull();
    expect(nextOpening(null)).toBeNull();
  });
});

describe("time conversion", () => {
  it("round-trips a time input", () => {
    expect(minutesToTime(540)).toBe("09:00");
    expect(minutesToTime(1_020)).toBe("17:00");
    expect(timeToMinutes("09:00")).toBe(540);
    expect(timeToMinutes("17:30")).toBe(1_050);
  });

  it("pads a single-digit hour", () => {
    expect(minutesToTime(65)).toBe("01:05");
  });

  it("rejects nonsense rather than storing it", () => {
    expect(timeToMinutes("25:00")).toBeNull();
    expect(timeToMinutes("09:70")).toBeNull();
    expect(timeToMinutes("")).toBeNull();
    expect(timeToMinutes("9am")).toBeNull();
  });
});

describe("normaliseBusinessHours", () => {
  it("drops a range that ends before it starts", () => {
    const result = normaliseBusinessHours({
      timezone: "UTC",
      days: [[], [{ start: 1_020, end: 540 }, { start: 540, end: 1_020 }], [], [], [], [], []],
    });
    expect(result?.days[1]).toHaveLength(1);
    expect(result?.days[1][0]).toEqual({ start: 540, end: 1_020 });
  });

  it("treats an all-closed schedule as no schedule", () => {
    // Otherwise availability would report "outside hours" forever, implying
    // hours that do not exist.
    expect(
      normaliseBusinessHours({ timezone: "UTC", days: [[], [], [], [], [], [], []] }),
    ).toBeNull();
  });

  it("always returns seven days", () => {
    const result = normaliseBusinessHours({
      timezone: "UTC",
      days: [[], [{ start: 540, end: 1_020 }]],
    });
    expect(result?.days).toHaveLength(7);
  });
});
