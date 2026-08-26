"use client";

import { useEffect, useState } from "react";
import { pasteOrigin } from "@/lib/crawl/pasted-urls";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
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
  /** URLs the crawler noticed in passing that nobody has reviewed. */
  suggested: number;
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
  awaitingReview = false,
  onApproved,
  onClose,
}: {
  agentId: string;
  source: {
    id: string;
    name: string;
    rootUrl: string | null;
    refreshIntervalHours: number | null;
    sitemapUrl: string | null;
    renderJs: string;
    metadata: Record<string, unknown> | null;
  };
  /** True when a crawl has discovered its URLs and is waiting to be approved. */
  awaitingReview?: boolean;
  /** Handed the job that is now running, so the dashboard can follow it. */
  onApproved?: (job: unknown) => void;
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
  const [addOpen, setAddOpen] = useState(false);
  const [addUrls, setAddUrls] = useState("");
  const [approving, setApproving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sitemapUrl, setSitemapUrl] = useState(source.sitemapUrl);
  const [savingSitemap, setSavingSitemap] = useState(false);
  const [renderJs, setRenderJs] = useState(source.renderJs ?? "auto");

  /**
   * Some sites build their pages in the visitor's browser rather than sending
   * them ready-made. We detect the common frameworks and run those pages in a
   * real browser automatically - but a hand-rolled one leaves no fingerprint to
   * detect, and arrives looking like an empty page with no content.
   */
  const saveRenderJs = async (value: string) => {
    setRenderJs(value);
    setNotice(null);
    try {
      await fetch(`/api/agents/${agentId}/sources/${source.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ renderJs: value }),
      });
      setNotice("Saved. It takes effect on the next crawl.");
    } catch {
      setNotice("Could not save that.");
    }
  };

  const discovery =
    (source.metadata?.discovery as {
      method?: string;
      sitemapUrl?: string | null;
      declaredSitemaps?: string[];
      urls?: number;
      truncated?: boolean;
    } | null) ?? null;

  const saveSitemap = async (value: string) => {
    setSavingSitemap(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/agents/${agentId}/sources/${source.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sitemapUrl: value }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not save that.");
      }
      setSitemapUrl(payload.data?.sitemapUrl ?? null);
      setNotice(
        value.trim()
          ? "Saved. The next crawl will use it."
          : "Cleared. The next crawl will look for one itself.",
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not save that.");
    } finally {
      setSavingSitemap(false);
    }
  };

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

  /**
   * Sends the approved list to the crawler, together with anything pasted.
   *
   * One button for both, because they are one decision: this is the set of
   * pages I want indexed. Splitting "save my additions" from "start indexing"
   * would let someone paste a list, walk away, and find nothing had happened.
   */
  const approve = async () => {
    setApproving(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/agents/${agentId}/sources/${source.id}/pages/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ addUrls }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not start indexing.");
      }
      // Hand back the job so the dashboard switches to watching it. Closing
      // without this left the page showing whichever job it had loaded with,
      // which after an approval is the one that just finished.
      onApproved?.(payload.data?.job);
      if (payload.data?.alreadyRunning) {
        // Say so rather than closing on a no-op. Silence here is what made
        // pressing the button twice feel reasonable in the first place.
        setNotice("A crawl is already running for this source.");
        return;
      }
      onClose();
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not start indexing.",
      );
    } finally {
      setApproving(false);
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
  const suggestedCount = data?.suggested ?? 0;
  const onSuggestions = outcome === "suggested";
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
            <span title="Run pages in a real browser before reading them. Use Always if your site builds its pages with JavaScript and we are finding them empty.">
              JavaScript
            </span>
            <select
              onChange={(event) => void saveRenderJs(event.target.value)}
              value={renderJs}
            >
              <option value="auto">Detect</option>
              <option value="always">Always render</option>
              <option value="never">Never render</option>
            </select>
          </label>
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
          {suggestedCount || onSuggestions ? (
            <button
              className={`source-pages-suggested-tab ${onSuggestions ? "is-active" : ""}`}
              onClick={() => {
                setOutcome(onSuggestions ? "all" : "suggested");
                setPage(1);
              }}
              type="button"
            >
              <Sparkles size={12} /> Found by us <i>{suggestedCount.toLocaleString()}</i>
            </button>
          ) : null}
          <span className="source-pages-bulk">
            <button
              className={addOpen ? "is-active" : ""}
              onClick={() => setAddOpen((current) => !current)}
              title="Add pages that discovery could not find"
              type="button"
            >
              <Plus size={13} /> Add pages
            </button>
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

        <DiscoveryReport
          discovery={discovery}
          onSave={(value) => void saveSitemap(value)}
          saving={savingSitemap}
          sitemapUrl={sitemapUrl}
        />
        {onSuggestions ? (
          <p className="source-pages-explainer">
            <b>These are guesses, not your pages.</b> While indexing, the
            crawler noticed these links on your site. Nobody has reviewed them,
            and some will be junk - pagination, tag archives, or pages you have
            no interest in. <b>You can ignore this list entirely.</b> Nothing
            here is indexed and none of it affects your chatbot&apos;s answers
            unless you turn it on.
          </p>
        ) : null}
        {addOpen ? (
          <div className="source-pages-add">
            <label>
              <b>Add pages by URL</b>
              <small>
                One per line. Paths work too, so <code>/pricing</code> means{" "}
                <code>{`${pasteOrigin(source.rootUrl) ?? ""}/pricing`}</code>.
                Use this for pages
                nothing links to and no sitemap lists - discovery cannot find
                those, because there is nothing to find them by.
              </small>
              <textarea
                onChange={(event) => setAddUrls(event.target.value)}
                placeholder={"/hidden-landing-page\n/2026/announcement\nhttps://example.com/deep/page"}
                rows={5}
                value={addUrls}
              />
            </label>
          </div>
        ) : null}

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

        {notice ? <p className="source-pages-notice">{notice}</p> : null}

        <div className="source-pages-approve">
          <span>
            {awaitingReview
              ? "This crawl is waiting for you. Nothing is fetched or indexed until you approve."
              : "Approving re-indexes the selected pages."}
          </span>
          <button
            className="app-primary-button"
            disabled={approving}
            onClick={() => void approve()}
            type="button"
          >
            {approving ? <LoaderCircle className="spin" size={14} /> : null}
            {approving
              ? "Starting…"
              : addUrls.trim()
                ? "Add pages and index"
                : "Approve and index"}
          </button>
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
/**
 * What discovery did, in the operator's words rather than the crawler's.
 *
 * The point of showing this is that only two of the four outcomes are good, and
 * the two that are not have a fix the operator can apply in thirty seconds -
 * but only if they know which one happened. A silent fallback to link-walking
 * looks identical to success right up until the page count is wrong.
 */
function DiscoveryReport({
  discovery,
  sitemapUrl,
  saving,
  onSave,
}: {
  discovery: {
    method?: string;
    sitemapUrl?: string | null;
    declaredSitemaps?: string[];
    urls?: number;
    truncated?: boolean;
  } | null;
  sitemapUrl: string | null;
  saving: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(sitemapUrl ?? "");
  const [open, setOpen] = useState(false);
  const method = discovery?.method;
  const walked = method === "links";

  const headline =
    method === "provided"
      ? "Using the sitemap you gave us"
      : method === "declared"
        ? "Using the sitemap your site publishes"
        : method === "guessed"
          ? "Found a sitemap at the usual address"
          : walked
            ? "No sitemap could be read"
            : "Not checked yet";

  return (
    <div className={`source-pages-discovery ${walked ? "is-warning" : ""}`}>
      <div>
        <b>{headline}</b>
        {discovery?.sitemapUrl ? (
          <small>
            <code>{discovery.sitemapUrl}</code>
            {discovery.urls ? ` · ${discovery.urls.toLocaleString()} pages listed` : null}
          </small>
        ) : walked ? (
          <small>
            We followed links from your homepage instead. That works, but it is
            slower and it finds pages a sitemap would not list as real ones -
            tag archives, pagination, search results. Your page list may be
            longer and noisier than your site actually is.
          </small>
        ) : (
          <small>Run a crawl and this will say how the page list was found.</small>
        )}
      </div>
      <button onClick={() => setOpen((current) => !current)} type="button">
        {sitemapUrl ? "Change sitemap" : "Set a sitemap"}
      </button>

      {open ? (
        <div className="source-pages-discovery-form">
          <label>
            <b>Sitemap address</b>
            <small>
              If you know where your sitemap is, paste it here and we will use
              it instead of searching. It has to be on the same domain.
            </small>
            <span>
              <input
                onChange={(event) => setValue(event.target.value)}
                placeholder="https://example.com/sitemap_index.xml"
                value={value}
              />
              <button
                className="app-primary-button"
                disabled={saving}
                onClick={() => onSave(value)}
                type="button"
              >
                Save
              </button>
            </span>
          </label>

          {discovery?.declaredSitemaps?.length ? (
            <p>
              Your <code>robots.txt</code> says the sitemap is at{" "}
              <code>{discovery.declaredSitemaps[0]}</code>
              {walked ? " — but we could not read it." : "."}
            </p>
          ) : null}

          {walked ? (
            <div className="source-pages-discovery-help">
              <b>If a sitemap exists but we cannot reach it</b>
              <p>
                This is almost always a firewall or a security plugin blocking
                automated requests. Two things usually fix it, in order of how
                little they cost you:
              </p>
              <ol>
                <li>
                  <b>Paste the address above.</b> Some setups block our guesses
                  at common paths but serve the real one fine.
                </li>
                <li>
                  <b>Allow us through for a few minutes.</b> Add{" "}
                  <code>ChatGrainBot</code> to your firewall or security
                  plugin&apos;s allowed list, run the crawl, then put it back if
                  you prefer. Discovery takes seconds, not hours.
                </li>
              </ol>
              <p>
                <b>You do not have to do either.</b> Following links works and
                needs nothing from you. It is just slower and less precise, and
                you may want to remove more pages by hand afterwards.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
