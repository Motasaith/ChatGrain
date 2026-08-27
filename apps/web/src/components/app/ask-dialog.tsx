"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { deleteConfirmationMatches } from "@/lib/agents/confirm-delete";

/**
 * An in-page replacement for `window.confirm` and `window.prompt`.
 *
 * Written because the native ones are not available: the browser refuses them
 * outright in some contexts and throws "prompt() is not supported", which meant
 * every administrator control failed at the moment it was clicked. They were a
 * poor fit anyway - a native prompt cannot show a count in bold, cannot
 * disable its own confirm button until the right name is typed, and cannot be
 * styled to look destructive when it is about to destroy something.
 *
 * The shape is deliberately the shape of the thing it replaces. `ask` returns a
 * promise resolving to the typed string, or to an empty string when the dialog
 * has no input, or to `null` when it was cancelled - so a call site keeps its
 * `if (answer === null) return;` and nothing else about it changes.
 *
 * Empty and cancelled are kept distinct on purpose. Several of these prompts
 * mean "leave it empty for the default", and a dialog that could not tell an
 * empty box from a closed window would silently reset a customer's limit every
 * time somebody changed their mind.
 */
export type AskOptions = {
  title: string;
  /** The consequences, in numbers where there are any. */
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button as destructive. */
  danger?: boolean;
  input?: {
    label: string;
    placeholder?: string;
    defaultValue?: string;
    /** Digits only, for the limit and cadence prompts. */
    numeric?: boolean;
    /**
     * Text that must be typed before confirming is possible.
     *
     * Matching is case- and whitespace-insensitive, borrowed from the agent
     * delete dialog: neither adds protection against picking the wrong thing,
     * and both are how a correct answer usually fails.
     */
    mustMatch?: string;
  };
};

type Pending = AskOptions & { resolve: (value: string | null) => void };

export function useAskDialog() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  // Held in a ref as well so the unmount cleanup can settle a promise that
  // would otherwise never resolve and leave its caller awaiting forever.
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((answer: string | null) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setValue("");
    current?.resolve(answer);
  }, []);

  useEffect(
    () => () => {
      pendingRef.current?.resolve(null);
      pendingRef.current = null;
    },
    [],
  );

  const ask = useCallback((options: AskOptions) => {
    return new Promise<string | null>((resolve) => {
      // A second dialog cannot open over the first, so the first is cancelled
      // rather than abandoned - its caller is waiting on that promise.
      pendingRef.current?.resolve(null);
      const next = { ...options, resolve };
      pendingRef.current = next;
      setValue(options.input?.defaultValue ?? "");
      setPending(next);
    });
  }, []);

  const dialog = pending ? (
    <AskDialog
      onCancel={() => settle(null)}
      onConfirm={() => settle(value)}
      onChange={setValue}
      options={pending}
      value={value}
    />
  ) : null;

  return { ask, dialog };
}

function AskDialog({
  options,
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  options: AskOptions;
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Escape closes it. Bound on the document rather than the dialog so it works
  // before anything inside has been focused.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const blocked = Boolean(
    options.input?.mustMatch &&
      !deleteConfirmationMatches(value, options.input.mustMatch),
  );

  return (
    <div
      className="agent-delete-backdrop"
      onClick={onCancel}
      role="presentation"
    >
      <form
        aria-label={options.title}
        aria-modal="true"
        className="agent-delete-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!blocked) onConfirm();
        }}
        role="dialog"
      >
        <h2>{options.title}</h2>
        <p>{options.body}</p>
        {options.input ? (
          <label className="field">
            <span>{options.input.label}</span>
            <input
              autoComplete="off"
              autoFocus
              inputMode={options.input.numeric ? "numeric" : undefined}
              onChange={(event) => onChange(event.target.value)}
              placeholder={options.input.placeholder}
              value={value}
            />
          </label>
        ) : null}
        <div className="agent-delete-actions">
          <button onClick={onCancel} type="button">
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            autoFocus={!options.input}
            className={options.danger ? "danger-button" : "primary-button"}
            disabled={blocked}
            type="submit"
          >
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}
