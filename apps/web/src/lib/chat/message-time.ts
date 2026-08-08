/**
 * Timestamp shown under a chat message.
 *
 * Older messages need their date, but a date on every line is noise in a
 * conversation that just happened, so the day is only spelled out once it is
 * no longer today.
 */
export type MessageTimeOptions = {
  locale?: string;
  /** Explicit zone keeps the day boundary testable; defaults to the viewer's. */
  timeZone?: string;
};

function calendarDay(date: Date, options: MessageTimeOptions) {
  // en-CA yields YYYY-MM-DD, which compares correctly as a string.
  return date.toLocaleDateString("en-CA", { timeZone: options.timeZone });
}

export function messageTimeLabel(
  value: string | undefined,
  now: Date = new Date(),
  options: MessageTimeOptions = {},
) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const time = date.toLocaleTimeString(options.locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: options.timeZone,
  });

  const day = calendarDay(date, options);
  const today = calendarDay(now, options);
  if (day === today) return time;

  const yesterday = calendarDay(
    new Date(now.getTime() - 86_400_000),
    options,
  );
  if (day === yesterday) return `Yesterday ${time}`;

  const sameYear = date.getFullYear() === now.getFullYear();
  const datePart = date.toLocaleDateString(options.locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: options.timeZone,
  });
  return `${datePart} ${time}`;
}
