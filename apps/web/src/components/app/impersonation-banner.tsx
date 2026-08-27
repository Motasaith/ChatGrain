"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, LoaderCircle, Pencil, X } from "lucide-react";

/**
 * A bar that cannot be dismissed, across the top of every page.
 *
 * The danger this guards against is not an administrator abusing impersonation.
 * It is an administrator forgetting they are in it - reading a customer's
 * agents, conversations and settings as though they were their own, and drawing
 * conclusions from them. Nothing in the interface would otherwise say whose
 * data is on screen, because the whole point is that it looks exactly like
 * theirs.
 *
 * So: no dismiss button, a colour used nowhere else, the workspace named, and a
 * countdown - so it is obvious both that this is happening and that it is about
 * to stop.
 */
export function ImpersonationBanner({
  workspaceName,
  canWrite,
  expiresAt,
}: {
  workspaceName: string;
  canWrite: boolean;
  expiresAt: number;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [remaining, setRemaining] = useState(() => expiresAt - Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemaining(expiresAt - Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  // The session ends on the server whether or not this page notices, so when
  // the clock runs out the only useful thing is to reload and become yourself
  // again. Without this the screen keeps showing a workspace the next request
  // will refuse to load.
  useEffect(() => {
    if (remaining > 0) return;
    router.refresh();
  }, [remaining, router]);

  const leave = async () => {
    setLeaving(true);
    try {
      await fetch("/api/admin/impersonate", { method: "DELETE" });
      // Back to the admin page rather than staying put: the page underneath
      // belongs to a workspace that is no longer resolvable.
      window.location.href = "/dashboard/admin";
    } catch {
      setLeaving(false);
    }
  };

  const minutes = Math.max(0, Math.floor(remaining / 60_000));
  const seconds = Math.max(0, Math.floor((remaining % 60_000) / 1_000));

  return (
    <div className={`impersonation-banner ${canWrite ? "is-write" : ""}`} role="alert">
      <span className="impersonation-badge">
        {canWrite ? <Pencil size={13} /> : <Eye size={13} />}
        {canWrite ? "Editing as" : "Viewing as"}
      </span>
      <b>{workspaceName}</b>
      <small>
        {canWrite
          ? "You can change things here. Everything you do is recorded against this workspace."
          : "This is somebody else's account. Read-only — nothing you do here can change it."}
      </small>
      <em>
        {minutes}:{String(seconds).padStart(2, "0")} left
      </em>
      <button disabled={leaving} onClick={() => void leave()} type="button">
        {leaving ? <LoaderCircle className="spin" size={13} /> : <X size={13} />}
        Leave
      </button>
    </div>
  );
}
