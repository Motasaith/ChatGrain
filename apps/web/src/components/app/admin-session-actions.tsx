"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Undo2 } from "lucide-react";
import { useAskDialog } from "@/components/app/ask-dialog";

type Change = { table: string; label: string; kind: string };

/**
 * Rolling back one administrator's editing session, after the fact.
 *
 * Offered for sessions that were kept and for sessions nobody closed properly,
 * which is most of them - a tab gets shut, an hour runs out. Those keep their
 * changes, deliberately, because silently undoing somebody's finished work
 * would leave the customer broken; this is what stops "kept" meaning
 * "permanent by accident".
 */
export function AdminSessionActions({
  sessionId,
  adminEmail,
  workspaceName,
  status,
  changes,
}: {
  sessionId: string;
  adminEmail: string;
  workspaceName: string;
  status: string;
  changes: Change[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog } = useAskDialog();

  // Nothing to put back, or it has already been put back.
  if (status === "discarded" || status === "reverted" || status === "expired" || !changes.length) {
    return null;
  }

  const revert = async () => {
    const ok = await ask({
      title: `Roll back this session on ${workspaceName}?`,
      body: (
        <>
          <p>
            This puts their configuration back as it stood before{" "}
            <b>{adminEmail}</b> started, undoing {changes.length}{" "}
            {changes.length === 1 ? "change" : "changes"}:
          </p>
          <ul className="impersonation-change-list">
            {changes.slice(0, 10).map((change) => (
              <li key={`${change.table}:${change.label}`}>
                <i>{change.kind}</i> {change.label}
              </li>
            ))}
            {changes.length > 10 ? (
              <li>…and {changes.length - 10} more</li>
            ) : null}
          </ul>
          <p>
            Anything the customer has changed themselves since is left alone.{" "}
            <b>Re-indexed pages are not restored</b> — a rebuilt corpus stays
            rebuilt.
          </p>
        </>
      ),
      confirmLabel: "Roll back",
      danger: true,
    });
    if (ok === null) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/sessions/${sessionId}`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "That did not work.");
      }
      const skipped = payload.data?.skipped ?? [];
      if (skipped.length) {
        await ask({
          title: "Rolled back, with exceptions",
          body: (
            <>
              <p>
                {payload.data.restored} row(s) restored. These were left as they
                are, because the customer changed them after the session ended:
              </p>
              <ul className="impersonation-change-list">
                {skipped.map((item: { table: string; label: string }) => (
                  <li key={`${item.table}:${item.label}`}>{item.label}</li>
                ))}
              </ul>
            </>
          ),
          confirmLabel: "Understood",
          cancelLabel: "Close",
        });
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="admin-workspace-actions">
      {dialog}
      {error ? <em title={error}>{error}</em> : null}
      <button disabled={busy} onClick={() => void revert()} type="button">
        {busy ? (
          <LoaderCircle className="spin" size={13} />
        ) : (
          <Undo2 size={13} />
        )}
        Roll back
      </button>
    </span>
  );
}
