"use client";

import { useState } from "react";
import { Check, LoaderCircle, Send } from "lucide-react";

export function ConversationActions({
  conversationId,
  initialStatus,
}: {
  conversationId: string;
  initialStatus: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  async function update(next: string, operatorMessage?: string) {
    setBusy(true);
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next, operatorMessage }),
    });
    if (response.ok) {
      setStatus(next);
      setReply("");
      window.location.reload();
    }
    setBusy(false);
  }

  return (
    <div className="conversation-actions">
      <div>
        <b>Conversation status</b>
        <select onChange={(event) => update(event.target.value)} value={status}>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="escalated">Escalated</option>
        </select>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); if (reply.trim()) update("open", reply.trim()); }}>
        <textarea onChange={(event) => setReply(event.target.value)} placeholder="Reply as an operator…" rows={3} value={reply} />
        <button disabled={busy || !reply.trim()}>
          {busy ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />} Send reply
        </button>
      </form>
      {status === "resolved" && <span className="resolved-note"><Check size={12} /> Marked resolved</span>}
    </div>
  );
}
