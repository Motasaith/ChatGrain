import { AppError } from "@/lib/http/errors";

/**
 * Uploads are staged and indexed by the worker rather than inside the request,
 * so the ceiling is no longer the request timeout. What remains is embedding
 * time, which scales with the text in the file rather than its bytes.
 */
const DEFAULT_USER_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_USER_CRAWL_PAGES = 10_000;
const DEFAULT_ADMIN_CRAWL_PAGES = 10_000;

function nonNegativeInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function userFileUploadLimit() {
  return nonNegativeInteger(
    process.env.USER_FILE_MAX_BYTES,
    DEFAULT_USER_FILE_BYTES,
  );
}

/**
 * A null limit means ChatGrain does not impose an application-level cap.
 * The reverse proxy, available memory, and request runtime can still limit
 * uploads, so production operators can set ADMIN_FILE_MAX_BYTES explicitly.
 */
export function fileUploadLimit(isAdmin: boolean) {
  if (!isAdmin) return userFileUploadLimit();
  const configured = nonNegativeInteger(process.env.ADMIN_FILE_MAX_BYTES, 0);
  return configured === 0 ? null : configured;
}

export function formatByteLimit(bytes: number | null) {
  if (bytes === null) return "no application-level limit";
  const mib = bytes / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
}

export function crawlPageLimit(isAdmin: boolean) {
  return isAdmin
    ? Math.max(
        1,
        nonNegativeInteger(
          process.env.ADMIN_CRAWL_MAX_PAGES,
          DEFAULT_ADMIN_CRAWL_PAGES,
        ),
      )
    : Math.max(
        1,
        nonNegativeInteger(
          process.env.USER_CRAWL_MAX_PAGES,
          DEFAULT_USER_CRAWL_PAGES,
        ),
      );
}

/**
 * The ceiling that applies to one workspace.
 *
 * A workspace may carry its own, set by an administrator. It is honoured in
 * both directions - a workspace can be given more than the installation's
 * default, or held below it - because both are things an administrator needs:
 * one customer with a large site, and one customer whose crawls are costing too
 * much.
 *
 * Null means "no override", which is not the same as zero and must not be
 * confused with it.
 */
export function workspaceCrawlPageLimit(
  isAdmin: boolean,
  workspaceLimit: number | null | undefined,
) {
  if (typeof workspaceLimit === "number" && workspaceLimit > 0) {
    return workspaceLimit;
  }
  return crawlPageLimit(isAdmin);
}

export function enforceCrawlPageLimit(
  value: number,
  isAdmin: boolean,
  workspaceLimit?: number | null,
) {
  const maximum = workspaceCrawlPageLimit(isAdmin, workspaceLimit);
  if (value > maximum) {
    const overridden =
      typeof workspaceLimit === "number" && workspaceLimit > 0;
    throw new AppError(
      "CRAWL_PAGE_LIMIT_EXCEEDED",
      overridden
        ? `This workspace is limited to ${maximum.toLocaleString()} pages. An administrator can change it.`
        : isAdmin
          ? `Administrator crawls are limited to ${maximum.toLocaleString()} pages by this deployment. Increase ADMIN_CRAWL_MAX_PAGES to raise it.`
          : `Website crawls are limited to ${maximum.toLocaleString()} pages.`,
      422,
    );
  }
  return value;
}

export function systemCrawlPageLimit() {
  return Math.max(
    crawlPageLimit(false),
    crawlPageLimit(true),
  );
}
