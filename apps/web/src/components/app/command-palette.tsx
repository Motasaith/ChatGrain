"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  LoaderCircle,
  MessageSquare,
  Search,
  Globe,
} from "lucide-react";
import type { SearchHit } from "@/app/api/search/route";

const ICON = {
  agent: Bot,
  conversation: MessageSquare,
  source: Globe,
} as const;

/**
 * The header search, which until now was a `<div>` containing a `<span>`.
 *
 * It advertised a keyboard shortcut, showed a magnifying glass, and did
 * nothing at all - so the first thing an operator tried in the product failed
 * silently. This is the smallest honest version of what it claimed: type,
 * see matching agents, conversations and sources, press enter to go there.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Closing clears the box. Stable, so the window key listener below binds once
  // and still calls the current version.
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced so a fast typist does not open a request per keystroke, and
  // aborted so an early slow response cannot overwrite a later fast one.
  useEffect(() => {
    // No state is set in the effect body. A short query is handled by deriving
    // `results` below instead, because clearing it here would make React render
    // twice for every keystroke that crosses the two-character line.
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        const payload = await response.json();
        setHits(payload?.data?.hits ?? []);
        setActive(0);
      } catch {
        // An aborted request is the normal case here, not a failure.
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // Below the minimum length there is nothing to show, whatever the last
  // completed search returned. Derived rather than stored so the two can never
  // disagree.
  const term = query.trim();
  const results = term.length >= 2 ? hits : [];
  const searching = busy && term.length >= 2;

  const go = (hit: SearchHit) => {
    close();
    router.push(hit.href);
  };

  return (
    <>
      <button
        aria-keyshortcuts="Meta+K Control+K"
        className="app-search"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Search size={16} />
        <span>Search agents, conversations, and sources</span>
        <kbd>⌘ K</kbd>
      </button>
      {open ? (
        <div
          className="command-palette-backdrop"
          onClick={close}
          role="presentation"
        >
          <div
            className="command-palette"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="Search"
            aria-modal="true"
          >
            <div className="command-palette-input">
              <Search size={17} />
              <input
                aria-label="Search agents, conversations, and sources"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((i) => Math.min(i + 1, results.length - 1));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((i) => Math.max(i - 1, 0));
                  }
                  if (event.key === "Enter" && results[active]) {
                    go(results[active]);
                  }
                }}
                placeholder="Search agents, conversations, and sources"
                ref={inputRef}
                value={query}
              />
              {searching ? <LoaderCircle className="spin" size={15} /> : null}
            </div>
            <div className="command-palette-results">
              {results.length ? (
                results.map((hit, index) => {
                  const Icon = ICON[hit.kind];
                  return (
                    <button
                      className={index === active ? "is-active" : ""}
                      key={`${hit.kind}-${hit.id}`}
                      onClick={() => go(hit)}
                      onMouseEnter={() => setActive(index)}
                      type="button"
                    >
                      <Icon size={15} />
                      <span>
                        <b>{hit.title}</b>
                        <small>{hit.subtitle}</small>
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="command-palette-empty">
                  {term.length < 2
                    ? "Type at least two characters."
                    : searching
                      ? "Searching…"
                      : `Nothing matches “${term}”.`}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
