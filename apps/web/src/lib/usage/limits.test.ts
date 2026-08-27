import { describe, expect, it, vi, afterEach } from "vitest";
import { workspaceCrawlPageLimit, enforceCrawlPageLimit } from "./limits";

afterEach(() => vi.unstubAllEnvs());

/**
 * A ceiling that belongs to one workspace.
 *
 * Every limit in this application used to be an environment variable, so
 * raising one customer's allowance meant an SSH session and a restart, applied
 * to everybody. This is the column that replaced that.
 */
describe("workspaceCrawlPageLimit", () => {
  it("falls back to the installation default when there is no override", () => {
    vi.stubEnv("USER_CRAWL_MAX_PAGES", "5000");
    expect(workspaceCrawlPageLimit(false, null)).toBe(5000);
    expect(workspaceCrawlPageLimit(false, undefined)).toBe(5000);
  });

  // Both directions matter: one customer with a large site, and one customer
  // whose crawls are costing too much.
  it("lets a workspace be raised above the default", () => {
    vi.stubEnv("USER_CRAWL_MAX_PAGES", "5000");
    expect(workspaceCrawlPageLimit(false, 50_000)).toBe(50_000);
  });

  it("lets a workspace be held below the default", () => {
    vi.stubEnv("USER_CRAWL_MAX_PAGES", "5000");
    expect(workspaceCrawlPageLimit(false, 100)).toBe(100);
  });

  // Null means "no override" and zero would mean "no pages at all". Treating
  // them alike would silently forbid every crawl in the workspace.
  it("does not read zero as a limit of zero", () => {
    vi.stubEnv("USER_CRAWL_MAX_PAGES", "5000");
    expect(workspaceCrawlPageLimit(false, 0)).toBe(5000);
  });
});

describe("enforceCrawlPageLimit", () => {
  it("accepts a request within the workspace's own limit", () => {
    vi.stubEnv("USER_CRAWL_MAX_PAGES", "100");
    expect(enforceCrawlPageLimit(900, false, 1000)).toBe(900);
  });

  it("refuses a request above it", () => {
    vi.stubEnv("USER_CRAWL_MAX_PAGES", "100000");
    expect(() => enforceCrawlPageLimit(2000, false, 1000)).toThrow();
  });

  // The message has to name the reason, or the customer is told the deployment
  // limits them when in fact an administrator chose a number for them.
  it("says an administrator can change it when the limit is theirs", () => {
    vi.stubEnv("USER_CRAWL_MAX_PAGES", "100000");
    expect(() => enforceCrawlPageLimit(2000, false, 1000)).toThrow(
      /administrator can change it/i,
    );
  });

  it("keeps the deployment-level message when there is no override", () => {
    vi.stubEnv("USER_CRAWL_MAX_PAGES", "1000");
    expect(() => enforceCrawlPageLimit(2000, false, null)).toThrow(
      /limited to 1,000 pages/i,
    );
  });
});
