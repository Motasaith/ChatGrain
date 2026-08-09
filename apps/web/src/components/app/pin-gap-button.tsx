"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pin } from "lucide-react";

/**
 * Turns an unanswered question into a pinned answer without leaving the report.
 *
 * The gap already knows the question and every phrasing it arrived in, so
 * retyping them in the agent's Knowledge tab is work the page can do itself.
 * Those variants matter: pin matching is deliberately strict, and listing the
 * wordings visitors actually used is what makes the pin fire.
 */
export function PinGapButton({
  agentId,
  question,
  variants,
}: {
  agentId: string;
  question: string;
  variants: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [questions, setQuestions] = useState([question, ...variants].join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const lines = questions
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const response = await fetch(`/api/agents/${agentId}/pinned`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: question.slice(0, 80),
          questions: lines,
          answer: answer.trim(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error?.message || "Could not save that answer.");
        return;
      }
      setSaved(true);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not save that answer.");
    } finally {
      setBusy(false);
    }
  }

  if (saved) return <span className="gaps-pinned">Pinned</span>;

  return (
    <>
      <button
        className="gaps-pin"
        onClick={() => setOpen(true)}
        title="Write an answer for this question"
        type="button"
      >
        <Pin size={12} /> Pin answer
      </button>

      {open ? (
        <div
          className="agent-delete-backdrop"
          onClick={() => (busy ? undefined : setOpen(false))}
          role="presentation"
        >
          <div
            aria-label="Pin an answer"
            aria-modal="true"
            className="agent-delete-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h2>Pin an answer</h2>
            <p>
              The agent will use this instead of searching, whenever a visitor
              asks one of these.
            </p>
            <label className="field">
              <span>Questions (one wording per line)</span>
              <textarea
                onChange={(event) => setQuestions(event.target.value)}
                rows={4}
                value={questions}
              />
            </label>
            <label className="field">
              <span>Answer</span>
              <textarea
                autoFocus
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="What should the agent say?"
                rows={5}
                value={answer}
              />
            </label>
            {error ? <p className="agent-delete-error">{error}</p> : null}
            <div className="agent-delete-actions">
              <button disabled={busy} onClick={() => setOpen(false)} type="button">
                Cancel
              </button>
              <button
                className="gaps-pin-save"
                disabled={busy || !answer.trim() || !questions.trim()}
                onClick={save}
                type="button"
              >
                {busy ? <LoaderCircle className="spin" size={14} /> : <Pin size={14} />}
                {busy ? "Saving..." : "Pin answer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
