import { AppError } from "@/lib/http/errors";

const DEFAULT_USER_FILE_BYTES = 5 * 1024 * 1024;
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
 * A null limit means Docent does not impose an application-level cap.
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

export function enforceCrawlPageLimit(value: number, isAdmin: boolean) {
  const maximum = crawlPageLimit(isAdmin);
  if (value > maximum) {
    throw new AppError(
      "CRAWL_PAGE_LIMIT_EXCEEDED",
      isAdmin
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
