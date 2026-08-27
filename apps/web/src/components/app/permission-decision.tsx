"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, ShieldOff, X } from "lucide-react";
import { useAskDialog } from "@/components/app/ask-dialog";

/**
 * Allow, decline, or withdraw.
 *
 * Declining is not styled as the destructive option and allowing is not styled
 * as the agreeable one. The safe answer here is "no" - it is always available
 * later, and a page that nudges towards yes is not asking for consent, it is
 * collecting it.
 */
export function PermissionDecision({
  token,
  adminEmail,
  status,
  expired,
  isOwner,
}: {
  token: string;
  adminEmail: string;
  status: string;
  expired: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog } = useAskDialog();

  const send = async (method: "POST" | "DELETE", decision?: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/impersonation-requests/${token}`, {
        method,
        headers: { "content-type": "application/json" },
        body: decision ? JSON.stringify({ decision }) : undefined,
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

  const approve = async () => {
    const ok = await ask({
      title: "Allow changes to your workspace?",
      body: (
        <>
          <b>{adminEmail}</b> will be able to change your agents, prompts,
          sources and settings. Everything they do appears in your activity, and
          you can withdraw this at any time.
        </>
      ),
      confirmLabel: "Allow",
    });
    if (ok === null) return;
    await send("POST", "approve");
  };

  const withdraw = async () => {
    const ok = await ask({
      title: "Withdraw permission?",
      body: (
        <>
          <b>{adminEmail}</b> will not be able to start a new session that can
          change anything. A session already open ends within the hour.
        </>
      ),
      confirmLabel: "Withdraw",
      danger: true,
    });
    if (ok === null) return;
    await send("DELETE");
  };

  if (!isOwner) {
    return (
      <p className="permission-note">
        Only an owner of this workspace can answer this. Ask whoever owns it to
        open this page.
      </p>
    );
  }

  if (status === "approved") {
    return (
      <div className="permission-actions">
        {dialog}
        <p className="permission-note">
          You allowed this. {adminEmail} can make changes until it expires.
        </p>
        <button disabled={busy} onClick={() => void withdraw()} type="button">
          {busy ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <ShieldOff size={14} />
          )}
          Withdraw permission
        </button>
        {error ? <p className="permission-error">{error}</p> : null}
      </div>
    );
  }

  if (status !== "pending") {
    return (
      <p className="permission-note">
        This request was {status}. Nothing more is needed from you.
      </p>
    );
  }

  if (expired) {
    return (
      <p className="permission-note">
        This request expired before it was answered, so no access was given. If
        it is still needed, ask them to send a new one.
      </p>
    );
  }

  return (
    <div className="permission-actions">
      {dialog}
      <button disabled={busy} onClick={() => void approve()} type="button">
        {busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
        Allow changes
      </button>
      <button
        disabled={busy}
        onClick={() => void send("POST", "decline")}
        type="button"
      >
        <X size={14} />
        Decline
      </button>
      {error ? <p className="permission-error">{error}</p> : null}
    </div>
  );
}
