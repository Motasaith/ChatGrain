"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";

/**
 * Per-user administrative actions.
 *
 * Deletion is irreversible and removes the user's workspaces along with every
 * agent and conversation in them, so it asks for typed confirmation rather than
 * a single click.
 */
export function AdminUserActions({
  userId,
  email,
  retentionExempt,
}: {
  userId: string;
  email: string;
  retentionExempt: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function toggleExempt() {
    setBusy("exempt");
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retentionExempt: !retentionExempt }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error?.message || "Could not update the user.");
        return;
      }
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    const typed = window.prompt(
      `Deleting ${email} also deletes any workspace they are the last member of, including its agents, sources and conversations.\n\nType the email address to confirm.`,
    );
    if (typed?.trim().toLowerCase() !== email.toLowerCase()) return;
    setBusy("delete");
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error?.message || "Could not delete the user.");
        return;
      }
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  return (
    <span className="admin-user-actions">
      {error ? <em title={error}>!</em> : null}
      <button
        aria-label={
          retentionExempt
            ? `Allow inactivity cleanup for ${email}`
            : `Protect ${email} from inactivity cleanup`
        }
        disabled={Boolean(busy)}
        onClick={() => void toggleExempt()}
        title={
          retentionExempt
            ? "Protected from inactivity cleanup"
            : "Subject to inactivity cleanup"
        }
        type="button"
      >
        {busy === "exempt" ? (
          <LoaderCircle className="spin" size={14} />
        ) : retentionExempt ? (
          <ShieldCheck size={14} />
        ) : (
          <ShieldOff size={14} />
        )}
      </button>
      <button
        aria-label={`Delete ${email}`}
        className="is-danger"
        disabled={Boolean(busy)}
        onClick={() => void remove()}
        type="button"
      >
        {busy === "delete" ? (
          <LoaderCircle className="spin" size={14} />
        ) : (
          <Trash2 size={14} />
        )}
      </button>
    </span>
  );
}
