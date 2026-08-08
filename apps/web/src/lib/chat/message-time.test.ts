import { describe, expect, it } from "vitest";
import { messageTimeLabel } from "./message-time";

const opts = { locale: "en-GB", timeZone: "UTC" };
const now = new Date("2026-08-08T15:00:00Z");

describe("messageTimeLabel", () => {
  it("shows only the time for today", () => {
    expect(messageTimeLabel("2026-08-08T09:05:00Z", now, opts)).toBe("09:05");
  });

  it("names yesterday rather than printing a date", () => {
    expect(messageTimeLabel("2026-08-07T22:40:00Z", now, opts)).toBe(
      "Yesterday 22:40",
    );
  });

  it("uses the calendar day, not a 24-hour window", () => {
    // 40 minutes earlier, but a different day: "Yesterday" is correct and
    // an elapsed-hours check would wrongly call this today.
    const justAfterMidnight = new Date("2026-08-08T00:20:00Z");
    expect(
      messageTimeLabel("2026-08-07T23:40:00Z", justAfterMidnight, opts),
    ).toBe("Yesterday 23:40");
  });

  it("adds the date for older messages", () => {
    expect(messageTimeLabel("2026-08-01T11:15:00Z", now, opts)).toBe(
      "1 Aug 11:15",
    );
  });

  it("includes the year once it differs", () => {
    expect(messageTimeLabel("2025-12-24T08:00:00Z", now, opts)).toContain(
      "2025",
    );
  });

  it("returns nothing for a missing or unparseable value", () => {
    expect(messageTimeLabel(undefined, now, opts)).toBe("");
    expect(messageTimeLabel("not-a-date", now, opts)).toBe("");
  });
});
