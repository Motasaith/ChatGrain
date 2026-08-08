"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

export type SupportFormKind = "support" | "bug" | "live";

type FieldSpec = {
  name: "subject" | "body" | "email" | "name";
  label: string;
  placeholder: string;
  multiline?: boolean;
  required?: boolean;
  type?: string;
};

/**
 * Each help-centre action collects what that request actually needs.
 *
 * A single generic form made every intent look the same to whoever picked the
 * ticket up: a broken checkout and a pricing question arrived identical.
 */
const FORMS: Record<
  SupportFormKind,
  { title: string; intro: string; submit: string; fields: FieldSpec[] }
> = {
  support: {
    title: "Contact support",
    intro: "A person will read this and reply in this widget.",
    submit: "Send request",
    fields: [
      { name: "subject", label: "What is this about?", placeholder: "Billing question", required: true },
      { name: "body", label: "Details", placeholder: "Tell us what you need help with.", multiline: true, required: true },
      { name: "email", label: "Email for updates", placeholder: "you@example.com", type: "email" },
    ],
  },
  bug: {
    title: "Report a problem",
    intro: "Tell us what broke and we will look into it.",
    submit: "Report problem",
    fields: [
      { name: "subject", label: "What went wrong?", placeholder: "Checkout button does nothing", required: true },
      { name: "body", label: "What did you expect to happen?", placeholder: "Steps you took, and what you expected instead.", multiline: true, required: true },
      { name: "email", label: "Email for updates", placeholder: "you@example.com", type: "email" },
    ],
  },
  live: {
    title: "Talk to a person",
    intro: "We will pick this up as soon as someone is free.",
    submit: "Request a person",
    fields: [
      { name: "subject", label: "What do you need?", placeholder: "Help choosing a plan", required: true },
      { name: "body", label: "Anything we should know first?", placeholder: "Optional context.", multiline: true, required: true },
      { name: "email", label: "Email so we can reach you", placeholder: "you@example.com", type: "email" },
    ],
  },
};

export function SupportForm({
  agentId,
  embedToken,
  kind,
  visitorId,
  onCancel,
  onSubmitted,
}: {
  agentId: string;
  embedToken?: string;
  kind: SupportFormKind;
  visitorId: string;
  onCancel: () => void;
  onSubmitted: (reference: string | null) => void;
}) {
  const spec = FORMS[kind];
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const missing = spec.fields.some(
    (field) => field.required && !values[field.name]?.trim(),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/public/agents/${encodeURIComponent(agentId)}/tickets`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(embedToken ? { authorization: `Bearer ${embedToken}` } : {}),
          },
          body: JSON.stringify({
            visitorId,
            kind,
            subject: values.subject?.trim(),
            body: values.body?.trim(),
            email: values.email?.trim() || undefined,
            name: values.name?.trim() || undefined,
            // Only meaningful for a bug report, and only when the widget is
            // embedded on the page being reported.
            pageUrl:
              kind === "bug"
                ? (window.location !== window.parent.location
                    ? document.referrer
                    : window.location.href) || undefined
                : undefined,
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error?.message || "Could not send that request.");
        return;
      }
      onSubmitted(payload?.data?.reference ?? null);
    } catch {
      setError("Could not send that request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="chat-support-form" onSubmit={submit}>
      <div className="chat-support-form-head">
        <b>{spec.title}</b>
        <small>{spec.intro}</small>
      </div>
      {spec.fields.map((field) => (
        <label className="field" key={field.name}>
          <span>
            {field.label}
            {field.required ? null : <i> (optional)</i>}
          </span>
          {field.multiline ? (
            <textarea
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [field.name]: event.target.value,
                }))
              }
              placeholder={field.placeholder}
              rows={4}
              value={values[field.name] ?? ""}
            />
          ) : (
            <input
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [field.name]: event.target.value,
                }))
              }
              placeholder={field.placeholder}
              type={field.type ?? "text"}
              value={values[field.name] ?? ""}
            />
          )}
        </label>
      ))}
      {error ? <p className="chat-support-form-error">{error}</p> : null}
      <div className="chat-support-form-actions">
        <button disabled={busy} onClick={onCancel} type="button">
          Back
        </button>
        <button disabled={busy || missing} type="submit">
          {busy ? <LoaderCircle className="spin" size={14} /> : null}
          {busy ? "Sending..." : spec.submit}
        </button>
      </div>
    </form>
  );
}
