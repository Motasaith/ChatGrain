"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { useAskDialog } from "@/components/app/ask-dialog";

type SourceRow = {
  id: string;
  name: string;
  status: string;
  rootUrl: string | null;
  documents: number;
};

/**
 * The two repairs an administrator can make inside somebody else's agent.
 *
 * Pausing is the precise version of suspending a workspace: an agent answering
 * badly - a poisoned corpus, a prompt someone broke - should be stoppable on
 * its own rather than by stopping the customer's whole account.
 *
 * Re-indexing is the other half. The support case this is for is a corpus that
 * is wrong rather than missing: a crawl that swallowed a site's error pages, or
 * one that ran against a build with a fault since fixed. Talking the customer
 * through pressing the button themselves works, but only when they are
 * available and only when they understand why.
 *
 * The source list is fetched on demand rather than rendered with the page. It
 * is a repair tool, opened for one agent at a time when something is wrong, and
 * loading every source for every agent to serve the rare case would make the
 * page slower for the common one.
 */
export function AdminAgentActions({
  agentId,
  agentName,
  status,
}: {
  agentId: string;
  agentName: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const { ask, dialog } = useAskDialog();

  const paused = status === "paused";

  const toggle = async () => {
    if (!paused) {
      const ok = await ask({
        title: `Pause ${agentName}?`,
        body: (
          <>
            Any crawl running now is stopped, and no new one starts. Queued work
            is kept and resumes when you unpause.
          </>
        ),
        confirmLabel: "Pause",
        danger: true,
      });
      if (ok === null) return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/agents/${agentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: paused ? "ready" : "paused" }),
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

  const loadSources = async () => {
    if (sources) {
      setSources(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/agents/${agentId}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not read sources.");
      }
      setSources(payload.data.sources);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const reindex = async (source: SourceRow) => {
    const ok = await ask({
      title: `Re-index ${source.name}?`,
      body: (
        <>
          This re-crawls the <b>{source.documents.toLocaleString()}</b> page
          {source.documents === 1 ? "" : "s"} already selected for this source
          and replaces what they say. The agent keeps answering from the old
          pages until the crawl finishes.
        </>
      ),
      confirmLabel: "Re-index",
    });
    if (ok === null) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/sources/${source.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reindex", autoApprove: true }),
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

  return (
    <span className="admin-agent-actions">
      {dialog}
      {error ? <em title={error}>{error}</em> : null}
      <button
        className={paused ? "is-suspended" : ""}
        disabled={busy}
        onClick={() => void toggle()}
        title={paused ? "Let this agent run again" : "Stop this agent's crawls"}
        type="button"
      >
        {busy ? (
          <LoaderCircle className="spin" size={13} />
        ) : paused ? (
          <Play size={13} />
        ) : (
          <Pause size={13} />
        )}
        {paused ? "Resume" : "Pause"}
      </button>
      <button
        disabled={busy}
        onClick={() => void loadSources()}
        title="Look at this agent's sources"
        type="button"
      >
        <Wrench size={13} />
        Sources
      </button>
      {sources ? (
        <span className="admin-source-popover">
          {sources.length ? (
            sources.map((source) => (
              <span className="admin-source-row" key={source.id}>
                <b title={source.rootUrl ?? undefined}>{source.name}</b>
                <i>{source.documents.toLocaleString()} pages</i>
                <button
                  disabled={busy}
                  onClick={() => void reindex(source)}
                  title="Re-crawl this source now"
                  type="button"
                >
                  <RefreshCw size={12} />
                  Re-index
                </button>
              </span>
            ))
          ) : (
            <span className="admin-source-row">
              <b>No sources on this agent.</b>
            </span>
          )}
        </span>
      ) : null}
    </span>
  );
}
