"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Clipboard, TriangleAlert } from "lucide-react";

/**
 * Copy to clipboard, with the two things the previous version lacked.
 *
 * It was `onClick={() => navigator.clipboard.writeText(text)}`, and it failed
 * in two ways that both look identical from the outside - nothing happens.
 *
 * **It said nothing when it worked.** No label change, no tick, no flash. A
 * button that gives no signal is indistinguishable from a broken one, so people
 * click it repeatedly and then paste to find out whether it worked. That alone
 * is what "the copy button isn't interactive" usually means.
 *
 * **And it genuinely did nothing over plain HTTP.** `navigator.clipboard` only
 * exists in a secure context - HTTPS, or localhost. Opened on a server's bare
 * IP and port, which is exactly how this application gets checked after a
 * deploy, the property is `undefined`, the click throws a TypeError into a
 * handler nobody was watching, and the button is dead in the literal sense.
 *
 * So: a fallback for the insecure case, a caught failure for the denied case,
 * and in the last resort the text is selected so the reader can press Ctrl+C
 * themselves - because a copy button that cannot copy should at least leave the
 * person one keystroke away rather than stranded.
 */
export function CopyButton({
  text,
  /** What the button is for, read by screen readers. */
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const timer = useRef<number | undefined>(undefined);
  const button = useRef<HTMLButtonElement>(null);

  // Cleared on unmount: the studio's tabs swap this component out, and a timer
  // firing afterwards would set state on something no longer mounted.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const settle = (next: "copied" | "manual") => {
    setState(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2_000);
  };

  /**
   * Selects the text on the page, so "Press Ctrl+C" is true rather than
   * hopeful.
   *
   * Found through `data-copy-source` rather than by class name: the button
   * needs to know which text it stands for, and an explicit attribute says so
   * where `closest(".code-block")` would quietly break the day somebody
   * restyles the container.
   */
  const selectSource = () => {
    const source = button.current
      ?.closest("[data-copy-source]")
      ?.querySelector("code, pre, textarea, input");
    if (!source) return false;
    if (source instanceof HTMLTextAreaElement || source instanceof HTMLInputElement) {
      source.select();
      return true;
    }
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  const copy = async () => {
    // The modern path, available only over HTTPS or on localhost.
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        settle("copied");
        return;
      } catch {
        // Denied by permissions policy, or the document was not focused.
        // Fall through rather than give up: the older path often still works.
      }
    }

    // The pre-clipboard-API way, which needs no secure context. Deprecated, and
    // still the only thing that works when this page is opened over plain HTTP
    // on a server address.
    try {
      const scratch = document.createElement("textarea");
      scratch.value = text;
      // Kept in the layout but out of sight: `display:none` cannot be selected,
      // and a fixed off-screen position avoids scrolling the page on focus.
      scratch.setAttribute("readonly", "");
      scratch.style.position = "fixed";
      scratch.style.top = "-1000px";
      scratch.style.opacity = "0";
      document.body.appendChild(scratch);
      scratch.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(scratch);
      if (copied) {
        settle("copied");
        return;
      }
    } catch {
      // Fall through to selecting it by hand.
    }

    // Nothing could copy it. Leaving the text selected turns a dead end into
    // one keystroke, and only then is the label honest.
    selectSource();
    settle("manual");
  };

  return (
    <button
      aria-label={label}
      className={`copy-button is-${state}`}
      onClick={() => void copy()}
      ref={button}
      type="button"
    >
      {state === "copied" ? (
        <Check size={14} />
      ) : state === "manual" ? (
        <TriangleAlert size={14} />
      ) : (
        <Clipboard size={14} />
      )}
      {/*
        Announced rather than only shown. A sighted user sees the label change;
        without this a screen reader user gets no confirmation at all, which is
        the same complaint that started this.
      */}
      <span aria-live="polite">
        {state === "copied"
          ? "Copied"
          : state === "manual"
            ? "Press Ctrl+C"
            : "Copy"}
      </span>
    </button>
  );
}
