"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Trash2 } from "lucide-react";
import { deleteConfirmationMatches } from "@/lib/agents/confirm-delete";

/**
 * Delete control for an agent card.
 *
 * Rendered as a sibling of the card's link rather than inside it: nesting a
 * button in an anchor means the click only reaches the right handler if the
 * hit testing is exactly right, and a destructive action is the worst place to
 * rely on that.
 */
export function AgentDeleteButton({
  agentId,
  agentName,
  sourceCount,
  conversationCount,
}: {
  agentId: string;
  agentName: string;
  sourceCount: number;
  conversationCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error?.message || "Could not delete the agent.");
        return;
      }
      setOpen(false);
      // The list is a server component and would otherwise keep showing it.
      router.refresh();
    } catch {
      setError("Could not delete the agent.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        aria-label={`Delete ${agentName}`}
        className="agent-card-delete"
        onClick={() => {
          setConfirmation("");
          setError("");
          setOpen(true);
        }}
        title={`Delete ${agentName}`}
        type="button"
      >
        <Trash2 size={15} />
      </button>

      {open ? (
        <div
          className="agent-delete-backdrop"
          onClick={() => (deleting ? undefined : setOpen(false))}
          role="presentation"
        >
          <div
            className="agent-delete-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Delete ${agentName}`}
          >
            <h2>Delete {agentName}?</h2>
            <p>
              This removes {sourceCount} source{sourceCount === 1 ? "" : "s"},
              every indexed page, and {conversationCount} conversation
              {conversationCount === 1 ? "" : "s"} with their tickets and
              captured leads. It cannot be undone.
            </p>
            <label className="field">
              {/* Typed rather than clicked: workspaces collect agents with
                  near-identical names, so a plain confirm makes deleting the
                  wrong one a single misclick. */}
              <span>Type the agent name to confirm</span>
              <input
                autoComplete="off"
                autoFocus
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={agentName}
                value={confirmation}
              />
            </label>
            {error ? <p className="agent-delete-error">{error}</p> : null}
            <div className="agent-delete-actions">
              <button
                disabled={deleting}
                onClick={() => setOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="danger-button"
                disabled={
                  deleting || !deleteConfirmationMatches(confirmation, agentName)
                }
                onClick={remove}
                type="button"
              >
                {deleting ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Trash2 size={15} />
                )}
                {deleting ? "Deleting..." : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
