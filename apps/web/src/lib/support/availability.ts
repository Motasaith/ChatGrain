import {
  isWithinBusinessHours,
  nextOpening,
  type BusinessHours,
} from "./business-hours";

/**
 * Whether the widget may offer a live person right now.
 *
 * Two signals, deliberately ANDed. Hours alone would promise a human at 09:00
 * on a day nobody came in; presence alone would flicker offline every time the
 * last operator closed their tab for lunch. Requiring both means "live" is
 * only shown when someone is both expected and actually there.
 */

/** An operator seen more recently than this is treated as at their desk. */
export const PRESENCE_TTL_MS = 90_000;

export type SupportAvailability = {
  live: boolean;
  /** Why not, so the widget can say something more useful than "offline". */
  reason: "live" | "outside_hours" | "nobody_available" | "not_configured";
  /** ISO instant support next opens, when that is knowable. */
  nextOpenAt?: string;
};

export function resolveAvailability({
  businessHours,
  lastOperatorSeenAt,
  now = new Date(),
}: {
  businessHours: BusinessHours | null | undefined;
  lastOperatorSeenAt: Date | null | undefined;
  now?: Date;
}): SupportAvailability {
  // No schedule means the team has not opted into live chat at all. Saying
  // "outside hours" would imply hours exist.
  if (!businessHours?.days?.some((day) => day.length)) {
    return { live: false, reason: "not_configured" };
  }

  const openNow = isWithinBusinessHours(businessHours, now);
  if (!openNow) {
    const next = nextOpening(businessHours, now);
    return {
      live: false,
      reason: "outside_hours",
      ...(next ? { nextOpenAt: next.toISOString() } : {}),
    };
  }

  const present =
    !!lastOperatorSeenAt &&
    now.getTime() - lastOperatorSeenAt.getTime() < PRESENCE_TTL_MS;
  if (!present) {
    // Inside hours but nobody at the desk: still a useful distinction, since
    // the visitor can reasonably expect a reply soon rather than tomorrow.
    return { live: false, reason: "nobody_available" };
  }

  return { live: true, reason: "live" };
}
