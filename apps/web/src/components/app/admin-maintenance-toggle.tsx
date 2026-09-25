"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, Wrench } from "lucide-react";
import { useAskDialog } from "@/components/app/ask-dialog";

/**
 * The maintenance switch.
 *
 * Turning it on is confirmed and takes an optional message, because it locks
 * every customer out of their dashboard and they will read whatever it says.
 * Turning it off is not: reopening is never the dangerous direction.
 */
export function AdminMaintenanceToggle({
  enabled,
  message,
  since,
  by,
}: {
  enabled: boolean;
  message: string;
  since: string | null;
  by: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog } = useAskDialog();

  async function change(next: boolean) {
    let text: string | undefined;
    if (next) {
      const answer = await ask({
        title: "Put the dashboard into maintenance?",
        body: (
          <>
            Every customer is shown a holding page instead of their dashboard until
            you turn this off. <b>Their agents keep answering visitors</b>; only the
            dashboard closes. Administrators are not affected. Leave the box empty
            for the standard message.
          </>
        ),
        input: { label: "Message for customers", placeholder: message },
        confirmLabel: "Turn on",
        danger: true,
      });
      if (answer === null) return;
      text = answer.trim() || undefined;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/maintenance-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next, message: text }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Could not change maintenance mode.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change maintenance mode.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`admin-maintenance${enabled ? " on" : ""}`}>
      <Wrench size={18} />
      <div>
        <b>{enabled ? "Maintenance mode is on" : "Maintenance mode is off"}</b>
        <small>
          {enabled
            ? `Customers see a holding page${since ? ` since ${new Date(since).toLocaleString("en")}` : ""}${by ? `, turned on by ${by}` : ""}.`
            : "Customers can use the dashboard. Turn on during a migration or a risky deploy."}
        </small>
        {enabled ? <small className="admin-maintenance-message">&ldquo;{message}&rdquo;</small> : null}
        {error ? <small className="admin-bad-text">{error}</small> : null}
      </div>
      <button
        className={enabled ? "admin-icon-text" : "admin-icon-text danger"}
        disabled={busy}
        onClick={() => change(!enabled)}
        type="button"
      >
        {busy ? <LoaderCircle className="spin" size={14} /> : null}
        {enabled ? "Turn off" : "Turn on"}
      </button>
      {dialog}
    </div>
  );
}
