"use client";

import { useState } from "react";

/**
 * A small daily bar chart with a tooltip per bar.
 *
 * One series per chart on purpose: sign-ups and answers run at very different
 * scales, and two scales on one axis mislead. Each column is a full-height hit
 * target so hovering near a short bar still works, and every column carries
 * its value as a label so the chart is readable without a pointer.
 */
export function AdminDailyBars({
  data,
  label,
  unit,
  tone = "green",
}: {
  data: Array<{ day: string; value: number }>;
  label: string;
  unit: string;
  tone?: "green" | "blue" | "purple";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((point) => point.value));
  const total = data.reduce((sum, point) => sum + point.value, 0);
  // Days are UTC dates; formatting them in UTC keeps the label on the same day.
  const format = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  return (
    <div className={`admin-bars admin-bars-${tone}`}>
      <div className="admin-bars-head">
        <p>{label}</p>
        <span>
          <b>{total.toLocaleString()}</b> in {data.length} days
        </span>
      </div>
      <div className="admin-bars-plot">
        <span className="admin-bars-max">{max.toLocaleString()}</span>
        <div className="admin-bars-columns">
          {data.map((point, index) => (
            <div
              aria-label={`${format(point.day)}: ${point.value} ${unit}`}
              className={hover !== null && hover !== index ? "dim" : undefined}
              key={point.day}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              role="img"
            >
              {point.value > 0 ? (
                <i style={{ height: `${(point.value / max) * 100}%` }} />
              ) : null}
              {hover === index ? (
                <span
                  className={
                    index >= data.length - 3
                      ? "tip right"
                      : index <= 2
                        ? "tip left"
                        : "tip"
                  }
                >
                  {format(point.day)} · <b>{point.value.toLocaleString()}</b> {unit}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="admin-bars-axis">
        <span>{data[0] ? format(data[0].day) : ""}</span>
        <span>{data.length ? format(data[data.length - 1].day) : ""}</span>
      </div>
    </div>
  );
}
