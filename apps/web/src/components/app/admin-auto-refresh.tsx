"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Re-renders the server component around it on an interval.
 *
 * `router.refresh()` rather than polling an endpoint: the page already knows
 * how to load itself, and a second code path for "the same data, but live"
 * would drift from the first.
 *
 * Paused while the tab is hidden, because an admin console left open in a
 * background tab overnight would otherwise query the database every fifteen
 * seconds for nobody. And switchable off, because a list that reshuffles
 * while somebody is reading it is worse than a list that is a minute old.
 */
export function AdminAutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  // The age is null until the first tick: the first render happens on the
  // server as well, and a clock read there would disagree with the browser's.
  const refreshedAt = useRef<number | null>(null);
  const [age, setAge] = useState<number | null>(null);

  useEffect(() => {
    refreshedAt.current = Date.now();
    const tick = setInterval(() => {
      if (refreshedAt.current !== null) {
        setAge(Math.max(0, Math.round((Date.now() - refreshedAt.current) / 1_000)));
      }
    }, 1_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      refreshedAt.current = Date.now();
    }, seconds * 1_000);
    return () => clearInterval(timer);
  }, [enabled, router, seconds]);

  return (
    <button
      aria-pressed={enabled}
      className={`admin-live${enabled ? " on" : ""}`}
      onClick={() => setEnabled((value) => !value)}
      title={enabled ? `Refreshing every ${seconds} seconds. Click to pause.` : "Paused. Click to refresh automatically."}
      type="button"
    >
      <i aria-hidden="true" />
      {enabled ? "Live" : "Paused"}
      <small>{age === null ? " " : `${age}s ago`}</small>
    </button>
  );
}
