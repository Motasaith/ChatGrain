"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleStop, LoaderCircle, RotateCcw } from "lucide-react";

const ACTIVE = new Set(["queued", "awaiting_review", "running"]);
const RETRYABLE = new Set(["failed", "partial", "cancelled"]);

/**
 * Stopping or retrying somebody else's crawl.
 *
 * This exists because of a real evening. Someone started training an agent,
 * left, and the job ran overnight stuck at 0% on a build with a known fault.
 * Nobody else could stop it - every job route resolves through the caller's own
 * workspace, so an administrator got the same 404 as a stranger - and the
 * choices were to wait for that person to come back or to open psql.
 *
 * Stopping is confirmed, because it is somebody else's work and they are
 * probably not in the room. The confirmation names whose crawl it is for the
 * same reason.
 */
export function AdminJobActions({
  jobId,
  label,
  status,
}: {
  jobId: string;
  label: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: "cancel" | "retry") => {
    if (action === "cancel") {
      const confirmed = window.confirm(
        `Stop the crawl of ${label}?\n\nThis belongs to another workspace. ` +
          `Whatever it has already indexed is kept, and the action is recorded ` +
          `in their audit trail under your name.`,
      );
      if (!confirmed) return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/jobs/${jobId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "That did not work.");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (!ACTIVE.has(status) && !RETRYABLE.has(status)) return null;

  return (
    <span className="admin-job-actions">
      {error ? <em title={error}>{error}</em> : null}
      {ACTIVE.has(status) ? (
        <button
          aria-label={`Stop the crawl of ${label}`}
          disabled={busy}
          onClick={() => void act("cancel")}
          title="Stop this crawl"
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={13} /> : <CircleStop size={13} />}
        </button>
      ) : (
        <button
          aria-label={`Retry the crawl of ${label}`}
          disabled={busy}
          onClick={() => void act("retry")}
          title="Retry this crawl"
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}
        </button>
      )}
    </span>
  );
}
