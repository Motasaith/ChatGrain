"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, LoaderCircle, Pencil } from "lucide-react";
import { useAskDialog } from "@/components/app/ask-dialog";

/**
 * Rename and duplicate, from the list rather than from inside the agent.
 *
 * Renaming was possible only by opening the agent, finding the Behaviour tab
 * and saving the whole form - four steps and a full page load to change one
 * word, which is why nobody did it and why workspaces fill up with agents
 * called "test". Duplicating was not possible at all: setting up a second agent
 * like the first meant copying a prompt between two browser tabs by hand.
 *
 * Both live beside the delete control, as siblings of the card's link rather
 * than nested inside it, on the same reasoning that put the delete button
 * there: a button inside an anchor only reaches the right handler if the hit
 * testing is exactly right, and these are not places to rely on that.
 */
export function AgentCardActions({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"rename" | "copy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog } = useAskDialog();

  const rename = async () => {
    const next = await ask({
      title: `Rename ${agentName}`,
      body: (
        <>
          Only the name changes. Anything already installed on a website keeps
          working — the widget is wired to the agent, not to what it is called.
        </>
      ),
      confirmLabel: "Rename",
      input: {
        label: "Name",
        defaultValue: agentName,
        placeholder: agentName,
      },
    });
    if (next === null) return;

    const trimmed = next.trim();
    // Matches the API, which is the only place that can actually enforce it.
    // Checked here too so the answer is instant rather than a round trip.
    if (trimmed.length < 2) {
      setError("A name needs at least two characters.");
      return;
    }
    if (trimmed === agentName) return;

    setBusy("rename");
    setError(null);
    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not rename it.");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename it.");
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async () => {
    const ok = await ask({
      title: `Make a copy of ${agentName}?`,
      body: (
        <>
          The copy gets this agent&apos;s prompt, appearance, behaviour settings,
          pinned answers and actions.
          <br />
          <br />
          <b>It does not get the indexed pages.</b> Copying a corpus would either
          duplicate tens of thousands of passages or quietly share them between
          two agents, and both go wrong later. The copy starts as a draft with no
          sources, ready for you to point it at something.
        </>
      ),
      confirmLabel: "Make a copy",
    });
    if (ok === null) return;

    setBusy("copy");
    setError(null);
    try {
      const response = await fetch(`/api/agents/${agentId}/duplicate`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not copy it.");
      }
      // Straight into the copy: the next thing anybody does after making one is
      // change something in it, and leaving them on the list to find it again
      // among near-identical names is the wrong place to stop.
      router.push(`/dashboard/agents/${payload.data.agent.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy it.");
      setBusy(null);
    }
  };

  return (
    <>
      {dialog}
      {error ? (
        <em className="agent-card-error" title={error}>
          {error}
        </em>
      ) : null}
      <button
        aria-label={`Rename ${agentName}`}
        className="agent-card-action"
        disabled={Boolean(busy)}
        onClick={() => void rename()}
        title={`Rename ${agentName}`}
        type="button"
      >
        {busy === "rename" ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <Pencil size={15} />
        )}
      </button>
      <button
        aria-label={`Make a copy of ${agentName}`}
        className="agent-card-action"
        disabled={Boolean(busy)}
        onClick={() => void duplicate()}
        title={`Make a copy of ${agentName}`}
        type="button"
      >
        {busy === "copy" ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <Copy size={15} />
        )}
      </button>
    </>
  );
}
