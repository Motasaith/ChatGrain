"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, FlaskConical, LoaderCircle, Pencil, X } from "lucide-react";
import { useAskDialog } from "@/components/app/ask-dialog";
import type { ImpersonationMode } from "@/lib/auth/impersonation-payload";

/**
 * What the bar says, per tier.
 *
 * The sandbox wording is the one that had to be got right. An administrator in
 * a sandbox is about to type into somebody else's agent, and needs to believe -
 * correctly - that it will not stick. Saying so plainly is what stops them
 * asking for full write access they do not need.
 */
const WORDING = {
  read: {
    label: "Viewing as",
    detail:
      "This is somebody else's account. Read-only — nothing you do here can change it.",
  },
  sandbox: {
    label: "Sandbox on",
    detail:
      "You can talk to their agent and reproduce what they see. Anything you say here is thrown away when you leave, and they never see it.",
  },
  write: {
    label: "Editing as",
    detail:
      "You can change anything. Their configuration was copied when you came in, so you can undo all of it when you leave — or later.",
  },
} as const;

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
  mode,
  expiresAt,
}: {
  workspaceName: string;
  mode: ImpersonationMode;
  expiresAt: number;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const { ask, dialog } = useAskDialog();
  /**
   * Null until the component has mounted, and deliberately so.
   *
   * A countdown is the current time minus a fixed point, and the current time
   * is different on the server than it is in the browser a moment later. Read
   * during the first render it produced markup saying "26" that React then
   * hydrated against a client saying "25", which is a hydration mismatch and
   * throws away the whole tree to re-render it.
   *
   * There is no value the server could send that would be right, so it sends
   * none: the clock starts when there is a clock to read.
   */
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(expiresAt - Date.now());
    // Once immediately, so the countdown appears on the render straight after
    // mount rather than a second later.
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  // The session ends on the server whether or not this page notices, so when
  // the clock runs out the only useful thing is to reload and become yourself
  // again. Without this the screen keeps showing a workspace the next request
  // will refuse to load.
  useEffect(() => {
    if (remaining === null || remaining > 0) return;
    router.refresh();
  }, [remaining, router]);

  const end = async (decision: "keep" | "discard") => {
    setLeaving(true);
    try {
      await fetch("/api/admin/impersonate", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      // Back to the admin page rather than staying put: the page underneath
      // belongs to a workspace that is no longer resolvable.
      window.location.href = "/dashboard/admin";
    } catch {
      setLeaving(false);
    }
  };

  /**
   * Leaving an editing session: decide about a named list, not about a feeling.
   *
   * The changes are fetched and shown because nobody remembers everything they
   * touched in twenty minutes, and "keep or discard?" with nothing named gets
   * answered wrongly. A session that changed nothing does not ask at all -
   * there is no decision to make, and a dialog with an empty list would train
   * people to dismiss the one that matters.
   */
  const leave = async () => {
    if (mode !== "write") {
      await end("keep");
      return;
    }

    setLeaving(true);
    let changes: { label: string; kind: string; table: string }[] = [];
    try {
      const response = await fetch("/api/admin/impersonate/changes");
      const payload = await response.json().catch(() => ({}));
      changes = payload?.data?.changes ?? [];
    } catch {
      // A failure to list them is not a reason to trap somebody in the session.
      // Keeping is the safe direction: the restore point survives either way.
    }
    setLeaving(false);

    if (!changes.length) {
      await end("keep");
      return;
    }

    const keep = await ask({
      title: `Keep your changes to ${workspaceName}?`,
      body: (
        <>
          <p className="impersonation-change-lead">
            You changed <b>{changes.length}</b>{" "}
            {changes.length === 1 ? "thing" : "things"}:
          </p>
          <ul className="impersonation-change-list">
            {changes.slice(0, 12).map((change) => (
              <li key={`${change.table}:${change.label}`}>
                <i>{change.kind}</i> {change.label}
              </li>
            ))}
            {changes.length > 12 ? (
              <li>…and {changes.length - 12} more</li>
            ) : null}
          </ul>
          <p className="impersonation-change-note">
            Discarding puts their configuration back as it was. Either way this
            session stays on record and can be rolled back later.{" "}
            <b>Re-indexing cannot be undone</b> — if you rebuilt their pages,
            those stay rebuilt.
          </p>
        </>
      ),
      confirmLabel: "Keep changes",
      cancelLabel: "Discard them",
    });

    // Cancel is the discard here, deliberately: the destructive-looking button
    // is the one that puts the customer's account back, and it should be the
    // easy one to reach.
    await end(keep === null ? "discard" : "keep");
  };

  const minutes = Math.max(0, Math.floor((remaining ?? 0) / 60_000));
  const seconds = Math.max(0, Math.floor(((remaining ?? 0) % 60_000) / 1_000));

  const wording = WORDING[mode];

  return (
    <div className={`impersonation-banner is-${mode}`} role="alert">
      {dialog}
      <span className="impersonation-badge">
        {mode === "write" ? (
          <Pencil size={13} />
        ) : mode === "sandbox" ? (
          <FlaskConical size={13} />
        ) : (
          <Eye size={13} />
        )}
        {wording.label}
      </span>
      <b>{workspaceName}</b>
      <small>{wording.detail}</small>
      {/* The placeholder is what the server renders and what the client renders
          on its first pass, so the two agree. It is one character wide so the
          bar does not jump when the real clock replaces it. */}
      <em>
        {remaining === null
          ? "—"
          : `${minutes}:${String(seconds).padStart(2, "0")} left`}
      </em>
      <button disabled={leaving} onClick={() => void leave()} type="button">
        {leaving ? <LoaderCircle className="spin" size={13} /> : <X size={13} />}
        Leave
      </button>
    </div>
  );
}
