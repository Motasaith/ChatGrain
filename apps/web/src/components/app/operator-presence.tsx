"use client";

import { useEffect } from "react";

/** Slightly under the 90s staleness window, so one missed beat is survivable. */
const HEARTBEAT_MS = 45_000;

/**
 * Tells the server an operator is at their desk.
 *
 * Renders nothing. Beats only while the tab is visible: a dashboard left open
 * on a locked laptop overnight would otherwise advertise a live person to
 * every visitor.
 */
export function OperatorPresence() {
  useEffect(() => {
    let cancelled = false;
    const beat = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      void fetch("/api/presence", { method: "POST" }).catch(() => undefined);
    };
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  return null;
}
