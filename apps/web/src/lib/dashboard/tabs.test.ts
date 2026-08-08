import { describe, expect, it } from "vitest";
import {
  HOME_TAB,
  MAX_TABS,
  closeTab,
  openTab,
  routeLabel,
  type DashboardTab,
} from "./tabs";

const tab = (href: string, label = href): DashboardTab => ({ href, label });

describe("routeLabel", () => {
  it("names the known sections", () => {
    expect(routeLabel("/dashboard/analytics")).toBe("Analytics");
    expect(routeLabel("/dashboard")).toBe("Overview");
    expect(routeLabel("/dashboard/api")).toBe("Developer API");
  });

  it("does not render a UUID as a tab name", () => {
    // Agent detail pages carry an id that would fill the whole tab.
    expect(routeLabel("/dashboard/agents/ab8cd8a5-d77a-4cdd-83bf-29621c0d3494"))
      .toBe("Agents");
    expect(routeLabel("/dashboard/activity/1255d072-c984-4976-949a-c86b2855bcc1"))
      .toBe("Activity");
  });

  it("tolerates a trailing slash", () => {
    expect(routeLabel("/dashboard/leads/")).toBe("Leads");
  });

  it("falls back to a readable name for unknown routes", () => {
    expect(routeLabel("/dashboard/billing-history")).toBe("Billing History");
  });
});

describe("openTab", () => {
  it("focuses an existing tab instead of duplicating it", () => {
    const tabs = [HOME_TAB, tab("/dashboard/leads", "Leads")];
    expect(openTab(tabs, tab("/dashboard/leads", "Leads"))).toHaveLength(2);
  });

  it("upgrades a placeholder label without moving the tab", () => {
    const tabs = [
      HOME_TAB,
      tab("/dashboard/agents/abc12345", "Agents"),
      tab("/dashboard/leads", "Leads"),
    ];
    const next = openTab(tabs, tab("/dashboard/agents/abc12345", "HOC 2.0"));
    expect(next[1].label).toBe("HOC 2.0");
    expect(next[2].href).toBe("/dashboard/leads");
  });

  it("evicts the oldest tab rather than growing forever", () => {
    let tabs = [HOME_TAB];
    for (let i = 0; i < MAX_TABS + 3; i += 1) {
      tabs = openTab(tabs, tab(`/dashboard/page-${i}`));
    }
    expect(tabs).toHaveLength(MAX_TABS);
    // Overview is pinned, so eviction must never take it.
    expect(tabs[0].href).toBe(HOME_TAB.href);
  });
});

describe("closeTab", () => {
  const tabs = [
    HOME_TAB,
    tab("/dashboard/agents", "Agents"),
    tab("/dashboard/analytics", "Analytics"),
    tab("/dashboard/leads", "Leads"),
  ];

  it("does not move you when closing a tab you are not on", () => {
    const result = closeTab(tabs, "/dashboard/agents", "/dashboard/leads");
    expect(result.nextHref).toBe("/dashboard/leads");
    expect(result.tabs).toHaveLength(3);
  });

  it("focuses the right-hand neighbour when closing the active tab", () => {
    const result = closeTab(tabs, "/dashboard/analytics", "/dashboard/analytics");
    expect(result.nextHref).toBe("/dashboard/leads");
  });

  it("falls back to the left neighbour at the end of the strip", () => {
    const result = closeTab(tabs, "/dashboard/leads", "/dashboard/leads");
    expect(result.nextHref).toBe("/dashboard/analytics");
  });

  it("refuses to close Overview so the strip is never empty", () => {
    const result = closeTab(tabs, "/dashboard", "/dashboard");
    expect(result.tabs).toHaveLength(4);
    expect(result.nextHref).toBe("/dashboard");
  });

  it("ignores a tab that is not open", () => {
    const result = closeTab(tabs, "/dashboard/nope", "/dashboard/leads");
    expect(result.tabs).toHaveLength(4);
    expect(result.nextHref).toBe("/dashboard/leads");
  });
});
