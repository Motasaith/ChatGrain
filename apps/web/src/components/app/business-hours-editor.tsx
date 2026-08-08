"use client";

import {
  DAY_NAMES,
  defaultBusinessHours,
  minutesToTime,
  timeToMinutes,
  type BusinessHours,
} from "@/lib/support/business-hours";

/**
 * Weekly support schedule.
 *
 * One row per day with a single open range, which covers how nearly every
 * small team actually works. Split shifts are representable in the stored
 * shape, so adding them later needs no migration.
 */
export function BusinessHoursEditor({
  value,
  onChange,
}: {
  value: BusinessHours | null;
  onChange: (next: BusinessHours | null) => void;
}) {
  const enabled = !!value;
  const hours = value ?? defaultBusinessHours(guessTimezone());

  function setDay(dayIndex: number, start: number, end: number) {
    const days = hours.days.map((day, index) =>
      index === dayIndex ? [{ start, end }] : day,
    );
    onChange({ ...hours, days });
  }

  return (
    <div className="business-hours">
      <label className="toggle-row">
        <input
          checked={enabled}
          onChange={(event) =>
            onChange(
              event.target.checked ? defaultBusinessHours(guessTimezone()) : null,
            )
          }
          type="checkbox"
        />
        <span>
          <b>Publish support hours</b>
          <small>
            Off means the widget never offers a live person, only a message.
          </small>
        </span>
      </label>

      {enabled ? (
        <>
          <label className="field">
            <span>Timezone</span>
            <input
              onChange={(event) =>
                onChange({ ...hours, timezone: event.target.value.trim() })
              }
              placeholder="Asia/Karachi"
              value={hours.timezone}
            />
            <small>
              An IANA name. Hours are read in this zone, not the visitor&apos;s.
            </small>
          </label>

          <div className="business-hours-days">
            {DAY_NAMES.map((name, index) => {
              const range = hours.days[index]?.[0];
              const open = !!range;
              return (
                <div className="business-hours-day" key={name}>
                  <label>
                    <input
                      checked={open}
                      onChange={(event) => {
                        const days = hours.days.map((day, dayIndex) =>
                          dayIndex === index
                            ? event.target.checked
                              ? [{ start: 540, end: 1_020 }]
                              : []
                            : day,
                        );
                        onChange({ ...hours, days });
                      }}
                      type="checkbox"
                    />
                    <b>{name.slice(0, 3)}</b>
                  </label>
                  {open ? (
                    <>
                      <input
                        onChange={(event) => {
                          const start = timeToMinutes(event.target.value);
                          if (start !== null) setDay(index, start, range.end);
                        }}
                        type="time"
                        value={minutesToTime(range.start)}
                      />
                      <span>to</span>
                      <input
                        onChange={(event) => {
                          const end = timeToMinutes(event.target.value);
                          if (end !== null) setDay(index, range.start, end);
                        }}
                        type="time"
                        value={minutesToTime(range.end)}
                      />
                    </>
                  ) : (
                    <em>Closed</em>
                  )}
                </div>
              );
            })}
          </div>
          <p className="business-hours-note">
            A live person is offered only inside these hours <b>and</b> when
            someone has the dashboard open. Outside either, visitors are invited
            to leave a message instead.
          </p>
        </>
      ) : null}
    </div>
  );
}

function guessTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
