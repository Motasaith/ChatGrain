"use client";

import { useState } from "react";
import { Check, LoaderCircle, Send } from "lucide-react";

export function ConversationActions({
  conversationId,
  initialStatus,
  ticket,
}: {
  conversationId: string;
  initialStatus: string;
  ticket?: {
    reference: string;
    status: string;
    priority: string;
  };
}) {
  const [status, setStatus] = useState(initialStatus);
  const [ticketStatus, setTicketStatus] = useState(ticket?.status || "");
  const [priority, setPriority] = useState(ticket?.priority || "normal");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function update({
    next,
    operatorMessage,
    nextTicketStatus,
    nextPriority,
  }: {
    next: string;
    operatorMessage?: string;
    nextTicketStatus?: string;
    nextPriority?: string;
  }) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: next,
          operatorMessage,
          ticketStatus: nextTicketStatus,
          priority: nextPriority,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.error?.message || "Could not update this conversation.",
        );
      }
      setStatus(operatorMessage ? "escalated" : next);
      if (nextTicketStatus) setTicketStatus(nextTicketStatus);
      if (nextPriority) setPriority(nextPriority);
      setReply("");
      window.location.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update this conversation.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="conversation-actions">
      <div>
        <b>Conversation status</b>
        <select
          onChange={(event) =>
            void update({ next: event.target.value })
          }
          value={status}
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="escalated">Escalated</option>
        </select>
      </div>
      {ticket ? (
        <div className="ticket-controls">
          <span><b>{ticket.reference}</b><small>Support ticket</small></span>
          <label>
            <span>Status</span>
            <select
              onChange={(event) => {
                const value = event.target.value;
                void update({
                  next:
                    value === "resolved" || value === "closed"
                      ? "resolved"
                      : "escalated",
                  nextTicketStatus: value,
                });
              }}
              value={ticketStatus}
            >
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="waiting_on_visitor">Waiting on visitor</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select
              onChange={(event) => {
                const value = event.target.value;
                void update({
                  next: status,
                  nextPriority: value,
                });
              }}
              value={priority}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>
      ) : null}
      <form onSubmit={(event) => {
        event.preventDefault();
        if (reply.trim()) {
          void update({
            next: ticket ? "escalated" : "open",
            operatorMessage: reply.trim(),
            nextTicketStatus: ticket ? "waiting_on_visitor" : undefined,
          });
        }
      }}>
        <textarea onChange={(event) => setReply(event.target.value)} placeholder="Reply as an operator…" rows={3} value={reply} />
        <button disabled={busy || !reply.trim()}>
          {busy ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />} Send reply
        </button>
        {error ? <span className="form-error">{error}</span> : null}
      </form>
      {status === "resolved" && <span className="resolved-note"><Check size={12} /> Marked resolved</span>}
    </div>
  );
}
