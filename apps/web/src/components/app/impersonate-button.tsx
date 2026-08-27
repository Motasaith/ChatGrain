"use client";

import { useState } from "react";
import { Eye, FlaskConical, LoaderCircle, Pencil } from "lucide-react";
import { useAskDialog } from "@/components/app/ask-dialog";

/**
 * Starting an impersonation session from the admin table.
 *
 * Three buttons rather than one, because the three tiers are genuinely
 * different decisions and burying them behind a menu would make the cheapest
 * one no easier to reach than the most expensive.
 *
 * The order matters. Looking is first because it answers most questions.
 * Sandbox is second because it answers most of the rest, and the whole reason
 * it exists is that "reproduce the fault" previously had no answer short of
 * full write access. Asking for write access is last, looks like the
 * exceptional thing it is, and cannot be granted from this side at all.
 *
 * A reason is asked for every time. Not enforced for looking - a required field
 * would collect the word "support" - but a prompt at the moment of doing it is
 * what makes the trail worth reading afterwards. For write access it *is*
 * enforced, because that text is what the customer reads before deciding.
 */
export function ImpersonateButton({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { ask, dialog } = useAskDialog();

  const enter = async (mode: "read" | "sandbox" | "write", reason: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, mode, reason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not start.");
      }
      // A full navigation rather than a router push: the cookie has just
      // changed, and every server component needs to be resolved again against
      // the workspace it now names.
      window.location.href = "/dashboard";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start.");
      setBusy(false);
    }
  };

  const start = async (mode: "read" | "sandbox") => {
    const reason = await ask({
      title:
        mode === "read"
          ? `View ${workspaceName} as an administrator?`
          : `Open a sandbox on ${workspaceName}?`,
      body:
        mode === "read" ? (
          <>
            You will see their dashboard exactly as they do. The session is{" "}
            <b>read-only</b>, expires by itself, and is recorded in their audit
            trail under your name.
          </>
        ) : (
          <>
            You will be able to <b>talk to their agent</b> and reproduce what
            they see. Nothing they own can be changed, and the conversations you
            have are thrown away when you leave — they never appear in the
            customer&apos;s activity.
          </>
        ),
      confirmLabel: mode === "read" ? "View as" : "Open sandbox",
      input: {
        label: "Why are you looking? (optional)",
        placeholder: "Support ticket, reported fault, …",
      },
    });
    if (reason === null) return;
    await enter(mode, reason);
  };

  /**
   * Asking the customer, or entering if they have already said yes.
   *
   * The same button for both, because from here they are the same intention -
   * "I need to change something" - and which of the two happens depends on a
   * grant the administrator cannot see and should not have to check first.
   */
  const requestWrite = async () => {
    const reason = await ask({
      title: `Ask ${workspaceName} for permission to make changes?`,
      body: (
        <>
          They decide, not you. What you write here is what they read before
          deciding, so say what you need to change and why —{" "}
          <b>&ldquo;fixing an issue&rdquo; is not something a person can
          consent to</b>.
        </>
      ),
      confirmLabel: "Send the request",
      input: {
        label: "What do you need to change, and why? (required)",
        placeholder: "Their welcome message still names the old product, and…",
      },
    });
    if (reason === null) return;
    if (reason.trim().length < 20) {
      setError("Say a little more — they have to be able to decide on it.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/impersonate/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, reason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not send.");
      }

      // Already granted: no point sending them a second request for something
      // they have given, so go straight in.
      if (payload.data.status === "already_granted") {
        await enter("write", reason);
        return;
      }

      const sent = payload.data.delivered;
      await ask({
        title: sent ? "Request sent" : "Send this to them yourself",
        body: sent ? (
          <>
            {workspaceName} has been emailed and can approve or decline it.
            Nothing has changed in their account. Once they approve, use this
            button again to enter.
          </>
        ) : (
          <>
            This installation has no outbound email configured, so nothing was
            sent. Copy the message below into whatever you already use to talk
            to them — the link only works for someone signed in as an owner of
            their workspace.
            <br />
            <br />
            <textarea
              className="permission-copy"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              rows={10}
              value={`${payload.data.message.subject}\n\n${payload.data.message.body}`}
            />
          </>
        ),
        confirmLabel: "Done",
        cancelLabel: "Close",
      });
      setNotice(sent ? "Waiting on their approval." : "Not sent — copy it over.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="admin-impersonate">
      {dialog}
      {error ? <em title={error}>{error}</em> : null}
      {!error && notice ? <i title={notice}>{notice}</i> : null}
      <button
        aria-label={`View ${workspaceName} as an administrator`}
        disabled={busy}
        onClick={() => void start("read")}
        title="See this workspace as its owner sees it"
        type="button"
      >
        {busy ? <LoaderCircle className="spin" size={13} /> : <Eye size={13} />}
        View as
      </button>
      <button
        aria-label={`Open a sandbox on ${workspaceName}`}
        disabled={busy}
        onClick={() => void start("sandbox")}
        title="Talk to their agent to reproduce a fault. Nothing is saved."
        type="button"
      >
        <FlaskConical size={13} />
        Sandbox
      </button>
      <button
        aria-label={`Ask ${workspaceName} for permission to make changes`}
        disabled={busy}
        onClick={() => void requestWrite()}
        title="Ask them for permission to change something"
        type="button"
      >
        <Pencil size={13} />
        Ask to edit
      </button>
    </span>
  );
}
