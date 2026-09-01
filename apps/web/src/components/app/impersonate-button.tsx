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
 * The order matters, and it is cheapest first. Looking answers most questions.
 * A sandbox answers most of the rest without touching anything the customer
 * owns. Editing answers the remainder, and is last because it is the one with
 * consequences - not because it is hard to reach.
 *
 * Editing asks nobody's permission. That was tried and reversed: a customer
 * paying for a managed service does not want a decision put to them, usually
 * has no basis on which to make it, and an emailed "click here to approve
 * access" link is shaped exactly like a phishing attempt. Reversibility
 * replaces consent - the configuration is copied on the way in, so anything
 * done can be undone on the way out or from the dashboard afterwards.
 *
 * A reason is asked for every time and required nowhere. A mandatory field
 * collects the word "support"; a prompt at the moment of acting is what makes
 * the trail worth reading, and for an editing session it is what labels the
 * restore point somebody may need to find later.
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

  /**
   * Starts a session, and reports why not if it could not.
   *
   * Returns the failure code rather than only showing a message, because one
   * caller needs to act on it: an installation with consent switched on refuses
   * an editing session, and that is a path to follow rather than an error to
   * put in front of somebody.
   */
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
        setBusy(false);
        return { ok: false, code: payload?.error?.code as string | undefined,
          message: payload?.error?.message as string | undefined };
      }
      // A full navigation rather than a router push: the cookie has just
      // changed, and every server component needs to be resolved again against
      // the workspace it now names.
      window.location.assign("/dashboard");
      return { ok: true };
    } catch {
      setBusy(false);
      return { ok: false, code: undefined, message: "Could not start." };
    }
  };

  const enterOrReport = async (
    mode: "read" | "sandbox" | "write",
    reason: string,
  ) => {
    const result = await enter(mode, reason);
    if (!result.ok) setError(result.message ?? "Could not start.");
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
    await enterOrReport(mode, reason);
  };

  /**
   * Entering an editing session.
   *
   * No permission is asked, and that is deliberate. A customer paying for a
   * managed service does not want a decision put to them, usually has no basis
   * on which to make it, and "click this link to approve access" is
   * structurally a phishing message - training people to click those is worse
   * security than not asking.
   *
   * Reversibility replaces consent. The configuration is copied on the way in,
   * so everything done here can be undone on the way out, or from the admin
   * dashboard days later if the fix turns out to have made things worse.
   *
   * Where an installation has turned consent back on, the route refuses and
   * says so, and `requestWrite` below is the path instead.
   */
  const edit = async () => {
    const reason = await ask({
      title: `Edit ${workspaceName}?`,
      body: (
        <>
          You will be able to change <b>anything</b> — their agent, its prompt,
          sources, actions and settings. Their configuration is copied first, so
          you can undo all of it when you leave, and roll it back later even if
          you do not.
          <br />
          <br />
          Re-indexing is the exception: a rebuilt corpus cannot be restored.
        </>
      ),
      confirmLabel: "Start editing",
      input: {
        label: "What are you fixing? (optional, kept with the restore point)",
        placeholder: "Welcome message names the old product…",
      },
    });
    if (reason === null) return;

    const result = await enter("write", reason);
    if (result.ok) return;
    // The one installation-dependent branch: consent is switched on here, so
    // the request flow is the way in rather than an error to report.
    if (result.code === "CONSENT_REQUIRED") {
      await requestWrite(reason);
      return;
    }
    setError(result.message ?? "Could not start.");
  };

  /**
   * Asking the customer, for installations that require it.
   *
   * Reached only when the editing route refuses, which happens when
   * IMPERSONATION_REQUIRE_CONSENT is on - some installations answer to
   * procurement rather than to a manager, and "support can change our
   * configuration without asking" ends some contracts.
   */
  const requestWrite = async (given?: string) => {
    const reason = given ?? await ask({
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
        aria-label={`Edit ${workspaceName}`}
        disabled={busy}
        onClick={() => void edit()}
        title="Change anything. Undoable when you leave, and afterwards."
        type="button"
      >
        <Pencil size={13} />
        Edit
      </button>
    </span>
  );
}
