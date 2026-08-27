"use client";

import { useState } from "react";
import { Eye, LoaderCircle } from "lucide-react";
import { useAskDialog } from "@/components/app/ask-dialog";

/**
 * Starting an impersonation session from the admin table.
 *
 * Read-only, always, from here. Write access exists but is not offered as a
 * one-click option next to a read-only one, because the two are not comparable
 * choices: one is looking and the other is acting inside somebody's account.
 * Anyone who genuinely needs to change something can request it deliberately
 * through the API, and that request lands in the audit trail as its own kind of
 * event.
 *
 * A reason is asked for and stored on the audit row. Not enforced - a required
 * field would just collect the word "support" - but a prompt at the moment of
 * doing it is what makes the trail worth reading afterwards.
 */
export function ImpersonateButton({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog } = useAskDialog();

  const start = async () => {
    const reason = await ask({
      title: `View ${workspaceName} as an administrator?`,
      body: (
        <>
          You will see their dashboard exactly as they do. The session is{" "}
          <b>read-only</b>, expires by itself, and is recorded in their audit
          trail under your name.
        </>
      ),
      confirmLabel: "View as",
      input: {
        label: "Why are you looking? (optional)",
        placeholder: "Support ticket, reported fault, …",
      },
    });
    // Cancel resolves null; an empty string is someone who chose not to say.
    if (reason === null) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, canWrite: false, reason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not start.");
      }
      // A full navigation rather than a router push: the cookie has just
      // changed, and every server component needs to be resolved again against
      // the workspace it now names.
      window.location.href = "/dashboard";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start.");
      setBusy(false);
    }
  };

  return (
    <span className="admin-impersonate">
      {dialog}
      {error ? <em title={error}>{error}</em> : null}
      <button
        aria-label={`View ${workspaceName} as an administrator`}
        disabled={busy}
        onClick={() => void start()}
        title="See this workspace as its owner sees it"
        type="button"
      >
        {busy ? <LoaderCircle className="spin" size={13} /> : <Eye size={13} />}
        View as
      </button>
    </span>
  );
}
