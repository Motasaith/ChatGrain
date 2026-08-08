/**
 * Whether a workspace is inside its published support hours.
 *
 * Timezone handling is the whole difficulty: the schedule is written in the
 * team's zone, but this runs on a server in UTC and is read by a visitor in a
 * third zone. Everything below resolves through the configured zone via Intl
 * rather than by shifting Date objects around, which is where hour arithmetic
 * usually goes wrong twice a year at a DST boundary.
 */

export type HourRange = {
  /** Minutes from midnight, in the schedule's own timezone. */
  start: number;
  end: number;
};

export type BusinessHours = {
  /** IANA zone, e.g. "Asia/Karachi". */
  timezone: string;
  /** Index 0 is Sunday, matching Date#getDay. */
  days: HourRange[][];
};

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Mon-Fri, 9 to 5, so an agent is never accidentally advertised as 24/7. */
export function defaultBusinessHours(timezone = "UTC"): BusinessHours {
  const nineToFive: HourRange[] = [{ start: 9 * 60, end: 17 * 60 }];
  return {
    timezone,
    days: [[], nineToFive, nineToFive, nineToFive, nineToFive, nineToFive, []],
  };
}

/**
 * Reads wall-clock day and minute in a given zone.
 *
 * `Intl` is the only thing that knows a zone's offset on a particular date,
 * including whether daylight saving applied.
 */
function zonedParts(instant: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(instant);
  const lookup = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = lookup("weekday");
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    weekday,
  );
  // "24" appears at midnight under hour12: false in some environments.
  const hour = Number(lookup("hour")) % 24;
  const minute = Number(lookup("minute"));
  return { dayIndex, minutesOfDay: hour * 60 + minute };
}

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function isWithinBusinessHours(
  hours: BusinessHours | null | undefined,
  now: Date = new Date(),
) {
  if (!hours?.days?.length) return false;
  const timezone = isValidTimezone(hours.timezone) ? hours.timezone : "UTC";
  const { dayIndex, minutesOfDay } = zonedParts(now, timezone);
  if (dayIndex < 0) return false;
  const ranges = hours.days[dayIndex] ?? [];
  return ranges.some(
    (range) => minutesOfDay >= range.start && minutesOfDay < range.end,
  );
}

/**
 * When support next opens, for the "we reply by ..." message.
 *
 * Scans forward a week; a schedule with no open ranges at all returns null
 * rather than looping.
 */
export function nextOpening(
  hours: BusinessHours | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (!hours?.days?.some((day) => day.length)) return null;
  const timezone = isValidTimezone(hours.timezone) ? hours.timezone : "UTC";
  // Minute granularity over one week is 10,080 steps: cheap, and it sidesteps
  // reimplementing calendar arithmetic in the schedule's zone.
  for (let step = 1; step <= 7 * 24 * 60; step += 1) {
    const candidate = new Date(now.getTime() + step * 60_000);
    const { dayIndex, minutesOfDay } = zonedParts(candidate, timezone);
    const ranges = hours.days[dayIndex] ?? [];
    if (ranges.some((range) => minutesOfDay === range.start)) return candidate;
  }
  return null;
}

/** "09:00" from minutes-since-midnight, for an <input type="time">. */
export function minutesToTime(minutes: number) {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Minutes since midnight from an <input type="time">, or null if unusable. */
export function timeToMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * Cleans a schedule coming from the editor before it is stored.
 *
 * Drops ranges that end at or before they start, which is what an unfinished
 * edit looks like, and would otherwise be stored as a day that never opens
 * while still reading as configured.
 */
export function normaliseBusinessHours(
  hours: BusinessHours,
): BusinessHours | null {
  const days = Array.from({ length: 7 }, (_, index) =>
    (hours.days[index] ?? [])
      .filter((range) => range.end > range.start)
      .map((range) => ({
        start: Math.max(0, Math.min(1_440, range.start)),
        end: Math.max(0, Math.min(1_440, range.end)),
      })),
  );
  // Nothing open at all is "no schedule", not a schedule of closed days.
  if (!days.some((day) => day.length)) return null;
  return { timezone: hours.timezone || "UTC", days };
}
