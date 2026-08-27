"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LoaderCircle,
  Pause,
  Play,
  SlidersHorizontal,
  Timer,
  Trash2,
} from "lucide-react";
import { useAskDialog } from "@/components/app/ask-dialog";

/**
 * Suspending a workspace, and giving it a page limit of its own.
 *
 * Both replace an SSH session. Every limit in this application was an
 * environment variable, so raising one customer's allowance meant editing a
 * file and restarting - for everybody - and there was no way at all to stop one
 * workspace without stopping the installation.
 *
 * Suspending asks for a reason and warns what it does, because it stops work
 * inside somebody else's account and they are not in the room. Lifting it does
 * not ask: undoing a restriction needs no ceremony.
 */
export function AdminWorkspaceActions({
  workspaceId,
  name,
  suspended,
  pageLimit,
  minRefreshHours,
}: {
  workspaceId: string;
  name: string;
  suspended: boolean;
  pageLimit: number | null;
  minRefreshHours: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog } = useAskDialog();

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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

  /**
   * Deleting a workspace: read the damage first, then say the name.
   *
   * Three things have to happen before a row disappears. The workspace must
   * already be suspended, which the route enforces - the reversible thing gets
   * tried first. The counts are fetched and shown, because "are you sure" is
   * not a question anybody can answer without them. And the name has to be
   * typed, because clicking the wrong row is easy and typing the wrong name is
   * not.
   */
  const remove = async () => {
    if (!suspended) {
      setError("Suspend this workspace first — that part can be undone.");
      return;
    }
    setBusy(true);
    setError(null);
    let preview: { agents: number; sources: number };
    try {
      const response = await fetch(`/api/admin/workspaces/${workspaceId}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not read the counts.");
      }
      preview = payload.data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
      setBusy(false);
      return;
    }
    setBusy(false);

    // The confirm button stays disabled until the name matches, so there is no
    // "that was not the name" path to fall down here.
    const typed = await ask({
      title: `Delete ${name}?`,
      body: (
        <>
          This removes <b>{preview.agents.toLocaleString()}</b> agent
          {preview.agents === 1 ? "" : "s"} and{" "}
          <b>{preview.sources.toLocaleString()}</b> source
          {preview.sources === 1 ? "" : "s"}, with every page, passage and
          conversation belonging to them. Their widget stops answering. Nothing
          here can undo it.
        </>
      ),
      confirmLabel: "Delete permanently",
      danger: true,
      input: {
        label: "Type the workspace name to confirm",
        placeholder: name,
        mustMatch: name,
      },
    });
    if (typed === null) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/admin/workspaces/${workspaceId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: typed }),
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

  const toggleSuspension = async () => {
    if (suspended) {
      await send({ suspended: false });
      return;
    }
    const reason = await ask({
      title: `Suspend ${name}?`,
      body: (
        <>
          New crawls will not start, and any crawl running now is stopped. Their
          chat widget keeps working — this pauses indexing, it does not take
          their agent offline.
        </>
      ),
      confirmLabel: "Suspend",
      danger: true,
      input: {
        label: "Reason (recorded in their audit trail)",
        placeholder: "Why is this being stopped?",
      },
    });
    if (reason === null) return;
    await send({ suspended: true, reason });
  };

  const setLimit = async () => {
    const entered = await ask({
      title: `Page limit for ${name}`,
      body: (
        <>
          The most pages one crawl in this workspace may index. Leave it empty
          to use the installation default.
        </>
      ),
      confirmLabel: "Save",
      input: {
        label: "Pages per crawl",
        numeric: true,
        defaultValue: pageLimit ? String(pageLimit) : "",
        placeholder: "Installation default",
      },
    });
    if (entered === null) return;
    const trimmed = entered.trim();
    if (!trimmed) {
      await send({ pageLimit: null });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      setError("That is not a whole number of pages.");
      return;
    }
    await send({ pageLimit: parsed });
  };

  /**
   * The floor under this workspace's re-crawl cadence.
   *
   * A customer who sets every source to refresh hourly is not doing anything
   * wrong by their own lights, but they are spending the installation's crawl
   * capacity and somebody has to be able to say no without editing their
   * settings for them.
   */
  const setCadence = async () => {
    const entered = await ask({
      title: `Minimum hours between re-crawls for ${name}`,
      body: (
        <>
          Sources set to refresh more often than this are held to it. Leave it
          empty to let each source keep its own schedule.
        </>
      ),
      confirmLabel: "Save",
      input: {
        label: "Hours",
        numeric: true,
        defaultValue: minRefreshHours ? String(minRefreshHours) : "",
        placeholder: "No floor",
      },
    });
    if (entered === null) return;
    const trimmed = entered.trim();
    if (!trimmed) {
      await send({ minRefreshHours: null });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      setError("That is not a whole number of hours.");
      return;
    }
    await send({ minRefreshHours: parsed });
  };

  return (
    <span className="admin-workspace-actions">
      {dialog}
      {error ? <em title={error}>{error}</em> : null}
      <button
        disabled={busy}
        onClick={() => void setLimit()}
        title={
          pageLimit
            ? `Limited to ${pageLimit.toLocaleString()} pages per crawl`
            : "Using the installation default page limit"
        }
        type="button"
      >
        <SlidersHorizontal size={13} />
        {pageLimit ? pageLimit.toLocaleString() : "Default"}
      </button>
      <button
        className={suspended ? "is-suspended" : ""}
        disabled={busy}
        onClick={() => void toggleSuspension()}
        title={suspended ? "Let this workspace run again" : "Pause indexing for this workspace"}
        type="button"
      >
        {busy ? (
          <LoaderCircle className="spin" size={13} />
        ) : suspended ? (
          <Play size={13} />
        ) : (
          <Pause size={13} />
        )}
        {suspended ? "Resume" : "Suspend"}
      </button>
      <button
        disabled={busy}
        onClick={() => void setCadence()}
        title={
          minRefreshHours
            ? `Re-crawls held to one every ${minRefreshHours}h`
            : "Each source keeps its own refresh schedule"
        }
        type="button"
      >
        <Timer size={13} />
        {minRefreshHours ? `${minRefreshHours}h` : "Any"}
      </button>
      {suspended ? (
        <button
          className="is-destructive"
          disabled={busy}
          onClick={() => void remove()}
          title="Delete this workspace and everything in it"
          type="button"
        >
          <Trash2 size={13} />
          Delete
        </button>
      ) : null}
    </span>
  );
}
