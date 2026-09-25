/**
 * Helpers shared by the admin console tabs.
 *
 * Every tab is a server component that reads its own filters from the URL, so
 * a filtered view is a link: it survives a refresh, a back button and being
 * pasted to a colleague, which a client-side filter would not.
 */

export type AdminSearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 25;

export function readParam(params: AdminSearchParams, key: string) {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function readPage(params: AdminSearchParams) {
  const page = Number.parseInt(readParam(params, "page"), 10);
  return Number.isFinite(page) && page > 0 ? page : 0;
}

/** A link to a tab with the given filters, leaving out the empty ones. */
export function adminHref(
  tab: string,
  params: Record<string, string | number | undefined> = {},
) {
  const search = new URLSearchParams({ tab });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== 0) {
      search.set(key, String(value));
    }
  }
  return `/dashboard/admin?${search.toString()}`;
}

/**
 * A search term as an ILIKE pattern. The wildcards are escaped so that someone
 * searching for "50%" finds that, rather than everything starting with "50".
 */
export function likePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export function formatBytes(input: number) {
  if (!Number.isFinite(input) || input <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(input) / Math.log(1024)),
  );
  return `${(input / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

export function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

/**
 * "3 hours ago". Tables show this and keep the exact time in a title, because
 * "is this recent" is the question a row is scanned for.
 */
export function formatRelative(value: Date | string) {
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
}

/**
 * How each session state reads as a pill.
 *
 * "kept" is deliberately not styled as success. Most sessions end that way
 * without anybody deciding - a closed tab, an expired hour - so a green tick
 * would be claiming a review that never happened.
 */
export const SESSION_PILL: Record<string, string> = {
  open: "training",
  kept: "queued",
  discarded: "ready",
  reverted: "ready",
};

/** Crawl job states onto the pill colours the rest of the dashboard uses. */
export const JOB_PILL: Record<string, string> = {
  queued: "training",
  running: "training",
  awaiting_review: "review",
  partial: "review",
  succeeded: "ready",
  failed: "error",
  cancelled: "queued",
};

export type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  level: string;
  count: string;
  lastSeen: string;
  permalink: string;
};

export async function loadSentryIssues() {
  const configured = Boolean(process.env.SENTRY_DSN);
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) {
    return {
      configured,
      connected: false,
      issues: [] as SentryIssue[],
      message: "Add SENTRY_AUTH_TOKEN with event:read scope to show issues here.",
    };
  }

  const base = (process.env.SENTRY_API_BASE_URL ?? "https://de.sentry.io").replace(
    /\/$/,
    "",
  );
  const org = process.env.SENTRY_ORG ?? "bina-codes";
  const project = process.env.SENTRY_PROJECT ?? "javascript-nextjs";
  try {
    const response = await fetch(
      `${base}/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/?limit=10`,
      {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    if (!response.ok) {
      return {
        configured,
        connected: false,
        issues: [] as SentryIssue[],
        message: `Sentry returned HTTP ${response.status}. Check the API base URL and token scope.`,
      };
    }
    return {
      configured,
      connected: true,
      issues: (await response.json()) as SentryIssue[],
      message: null,
    };
  } catch (error) {
    return {
      configured,
      connected: false,
      issues: [] as SentryIssue[],
      message: error instanceof Error ? error.message : "Sentry is unavailable.",
    };
  }
}
