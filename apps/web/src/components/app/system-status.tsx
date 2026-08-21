"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, LoaderCircle } from "lucide-react";

type Health = {
  ok: boolean;
  version?: string;
  services?: Record<string, string>;
  latencyMs?: number;
};

/** Services whose value is a state rather than a name get a coloured dot. */
const TONE: Record<string, "good" | "warn" | "bad"> = {
  up: "good",
  stale: "warn",
  unknown: "warn",
  down: "bad",
};

/**
 * The header pulse icon.
 *
 * It used to be a link straight to `/api/health`, which navigated the operator
 * out of the dashboard and onto a page of raw JSON - technically the
 * information, in the least usable form it could take, with no way back but the
 * browser's own button. Same data, read in place.
 */
export function SystemStatus() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/health")
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        setHealth(payload);
        // Cleared here rather than before the request, so the reset happens in
        // a callback instead of synchronously inside the effect body.
        setFailed(false);
      })
      .catch(() => {
        // A health check that cannot be reached is itself the answer.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const services = Object.entries(health?.services ?? {});

  return (
    <div className="system-status" ref={wrapper}>
      <button
        aria-expanded={open}
        aria-label="System status"
        onClick={() => setOpen((current) => !current)}
        title="System status"
        type="button"
      >
        <Activity size={18} />
      </button>
      {open ? (
        <div className="system-status-popover" role="dialog" aria-label="System status">
          <div className="system-status-heading">
            <b>System status</b>
            {health ? (
              <i className={health.ok ? "is-good" : "is-bad"}>
                {health.ok ? "Operational" : "Degraded"}
              </i>
            ) : null}
          </div>
          {failed ? (
            <p>The health check could not be reached from this browser.</p>
          ) : !health ? (
            <p>
              <LoaderCircle className="spin" size={14} /> Checking…
            </p>
          ) : (
            <>
              <dl>
                {services.map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>
                      {TONE[value] ? (
                        <em className={`is-${TONE[value]}`} />
                      ) : null}
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <small>
                {health.version ? `v${health.version}` : null}
                {health.latencyMs !== undefined
                  ? ` · answered in ${health.latencyMs}ms`
                  : null}
              </small>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
