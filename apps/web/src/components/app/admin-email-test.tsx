"use client";

import { useState } from "react";
import { LoaderCircle, Send } from "lucide-react";

/** Sends a test message to the administrator pressing it, and says what happened. */
export function AdminEmailTest({ configured, email }: { configured: boolean; email: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/email-test", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "The test message was not sent.");
      setResult({ ok: true, text: `Sent to ${payload.data.sentTo}. Check that inbox, and its spam folder.` });
    } catch (reason) {
      setResult({ ok: false, text: reason instanceof Error ? reason.message : "The test message was not sent." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-email-test">
      <button className="admin-icon-text" disabled={busy || !configured} onClick={send} type="button">
        {busy ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}
        Send a test to {email}
      </button>
      {result ? (
        <p aria-live="polite" className={result.ok ? "admin-good-text" : "admin-bad-text"} role="status">
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
