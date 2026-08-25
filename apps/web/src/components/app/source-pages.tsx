"use client";

import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  LoaderCircle,
  Search,
  Trash2,
  X,
} from "lucide-react";

type PageRow = {
  id: string;
  url: string;
  title: string | null;
  outcome: string;
  reason: string | null;
  chunkCount: number;
  selected: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
};

type Payload = {
  pages: PageRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  outcomes: Record<string, number>;
};

/**
 * Re-crawl cadences, as hours.
 *
 * Offered as four choices rather than a number field because the column is
 * consulted by a scheduler that runs hourly - the difference between 168 and
 * 170 hours is not a decision anyone needs to make.
 */
const SCHEDULES = [
  { label: "Never", hours: null },
  { label: "Daily", hours: 24 },
  { label: "Weekly", hours: 168 },
  { label: "Monthly", hours: 720 },
] as const;

const SORTS = [
  { key: "sequence", label: "Crawl order" },
  { key: "url", label: "URL" },
  { key: "title", label: "Title" },
  { key: "firstSeen", label: "First seen" },
  { key: "lastSeen", label: "Last seen" },
] as const;

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString();
}

/**
 * The page inventory for one website source.
 *
 * Exists because "it indexed 8,797 pages" is not something anyone can act on.
 * This is the list behind that number: what was fetched, what was skipped and
 * why, and which pages the operator wants left alone next time.
 */
export function SourcePages({
  agentId,
  source,
  onClose,
}: {
  agentId: string;
  source: {
    id: string;
    name: string;
    rootUrl: string | null;
    refreshIntervalHours: number | null;
  };
  onClose: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** Bumped after a mutation to re-run the load effect without duplicating it. */
  const [reloadToken, setReloadToken] = useState(0);
  const [outcome, setOutcome] = useState("all");
  const [sort, setSort] = useState<string>("sequence");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [schedule, setSchedule] = useState(source.refreshIntervalHours);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  const base = `/api/agents/${agentId}/sources/${source.id}/pages`;

  // One effect owns loading, and it runs behind a short timer.
  //
  // The timer is doing two jobs. It debounces typing in the filter box, so a
  // fast typist does not open a request per keystroke. It also moves every
  // `setState` out of the effect body and into a callback, which is what keeps
  // one user action to one render pass rather than a cascade.
  useEffect(() => {
    const controller = new AbortController();
    const term = query.trim();
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const params = new URLSearchParams({
          outcome,
          sort,
          order,
          page: String(page),
        });
        if (term) params.set("q", term);
        const response = await fetch(`${base}?${params}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Could not load pages.");
        }
        setData(payload.data);
        setError(null);
      } catch (cause) {
        // An aborted request is the normal case when a filter changes mid-flight.
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "Could not load pages.",
        );
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [base, query, outcome, sort, order, page, reloadToken]);

  const reload = () => setReloadToken((current) => current + 1);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setSelected = async (urls: string[], selected: boolean) => {
    setWorking(urls.length === 1 ? urls[0]! : "bulk");
    try {
      await fetch(base, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls, selected }),
      });
      reload();
    } finally {
      setWorking(null);
    }
  };

  const setAllMatching = async (selected: boolean) => {
    setWorking("bulk");
    try {
      await fetch(base, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          all: true,
          outcome,
          q: query.trim(),
          selected,
        }),
      });
      reload();
    } finally {
      setWorking(null);
    }
  };

  const remove = async (url: string) => {
    setWorking(url);
    try {
      await fetch(base, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: [url] }),
      });
      reload();
    } finally {
      setWorking(null);
    }
  };

  const saveSchedule = async (hours: number | null) => {
    setSchedule(hours);
    setSavingSchedule(true);
    try {
      await fetch(`/api/agents/${agentId}/sources/${source.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshIntervalHours: hours }),
      });
    } finally {
      setSavingSchedule(false);
    }
  };

  const outcomes = data?.outcomes ?? {};
  const tabs = [
    ["all", "All", Object.values(outcomes).reduce((a, b) => a + b, 0)],
    ...Object.entries(outcomes)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => [key, key, count] as const),
  ] as Array<[string, string, number]>;

  return (
    <div className="source-pages-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label={`Pages in ${source.name}`}
        aria-modal="true"
        className="source-pages"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <b>{source.name}</b>
            <small>
              {data
                ? `${data.total.toLocaleString()} of ${(
                    tabs[0]?.[2] ?? 0
                  ).toLocaleString()} pages shown`
                : "Loading pages…"}
            </small>
          </div>
          <label className="source-pages-schedule">
            <span>Recrawl</span>
            <select
              disabled={savingSchedule}
              onChange={(event) =>
                void saveSchedule(
                  event.target.value === "null"
                    ? null
                    : Number(event.target.value),
                )
              }
              value={schedule === null ? "null" : String(schedule)}
            >
              {SCHEDULES.map((item) => (
                <option
                  key={item.label}
                  value={item.hours === null ? "null" : String(item.hours)}
                >
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button aria-label="Close" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </header>

        <div className="source-pages-controls">
          <span className="source-pages-search">
            <Search size={15} />
            <input
              onChange={(event) => {
                setQuery(event.target.value);
                // A filter that keeps you on page 8 of the previous result set
                // looks like it found nothing.
                setPage(1);
              }}
              placeholder="Filter by URL or title"
              value={query}
            />
          </span>
          <select
            onChange={(event) => {
              setSort(event.target.value);
              setPage(1);
            }}
            value={sort}
          >
            {SORTS.map((item) => (
              <option key={item.key} value={item.key}>
                Order by {item.label}
              </option>
            ))}
          </select>
          <select
            onChange={(event) => setOrder(event.target.value as "asc" | "desc")}
            value={order}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
          {busy ? <LoaderCircle className="spin" size={15} /> : null}
        </div>

        <div className="source-pages-tabs">
          {tabs.map(([key, label, count]) => (
            <button
              className={outcome === key ? "is-active" : ""}
              key={key}
              onClick={() => {
                setOutcome(key);
                setPage(1);
              }}
              type="button"
            >
              {label} <i>{count.toLocaleString()}</i>
            </button>
          ))}
          <span className="source-pages-bulk">
            <button
              disabled={working === "bulk"}
              onClick={() => void setAllMatching(false)}
              title="Stop crawling every page matching the current filter"
              type="button"
            >
              <EyeOff size={13} /> Exclude all shown
            </button>
            <button
              disabled={working === "bulk"}
              onClick={() => void setAllMatching(true)}
              type="button"
            >
              <Eye size={13} /> Include all shown
            </button>
          </span>
        </div>

        <div className="source-pages-list">
          {error ? (
            <p className="source-pages-empty">{error}</p>
          ) : data?.pages.length ? (
            data.pages.map((row) => (
              <article
                className={row.selected ? "" : "is-excluded"}
                key={row.id}
              >
                <div>
                  <b>{row.title || row.url.replace(/^https?:\/\//, "")}</b>
                  <a href={row.url} rel="noreferrer" target="_blank">
                    {row.url}
                  </a>
                  {row.reason ? <em>{row.reason}</em> : null}
                </div>
                <i className={`page-outcome is-${row.outcome}`}>{row.outcome}</i>
                <small>{when(row.lastSeenAt)}</small>
                <span className="source-pages-row-actions">
                  <button
                    aria-label={
                      row.selected
                        ? `Stop crawling ${row.url}`
                        : `Crawl ${row.url} again`
                    }
                    disabled={working === row.url}
                    onClick={() => void setSelected([row.url], !row.selected)}
                    title={
                      row.selected
                        ? "Exclude this page from future crawls"
                        : "Include this page again"
                    }
                    type="button"
                  >
                    {row.selected ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button
                    aria-label={`Delete ${row.url}`}
                    className="source-pages-delete"
                    disabled={working === row.url}
                    onClick={() => void remove(row.url)}
                    title="Remove this page from the index and the list"
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </article>
            ))
          ) : (
            <p className="source-pages-empty">
              {busy
                ? "Loading…"
                : query.trim() || outcome !== "all"
                  ? "No pages match this filter."
                  : "No pages recorded yet. They appear here as the crawl runs."}
            </p>
          )}
        </div>

        <footer>
          <button
            disabled={page <= 1 || busy}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            type="button"
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            Page {data?.page ?? 1} of {data?.pageCount ?? 1}
          </span>
          <button
            disabled={busy || (data ? data.page >= data.pageCount : true)}
            onClick={() => setPage((current) => current + 1)}
            type="button"
          >
            <ChevronRight size={15} />
          </button>
        </footer>
      </div>
    </div>
  );
}
