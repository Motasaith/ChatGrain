/**
 * Open-tab bookkeeping for the dashboard's in-app tab strip.
 *
 * Kept as pure functions because the awkward parts - which tab takes focus
 * when you close the active one, not letting the strip grow without bound -
 * are logic, not rendering, and are far easier to get right under test than by
 * clicking around a browser.
 */

export type DashboardTab = {
  href: string;
  label: string;
};

/** Past this the strip stops being navigation and becomes a scrolling mess. */
export const MAX_TABS = 8;

/** Always present, and never closable, so the strip can never be empty. */
export const HOME_TAB: DashboardTab = {
  href: "/dashboard",
  label: "Overview",
};

const STATIC_LABELS: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/agents": "Agents",
  "/dashboard/agents/new": "New agent",
  "/dashboard/activity": "Activity",
  "/dashboard/analytics": "Analytics",
  "/dashboard/leads": "Leads",
  "/dashboard/tickets": "Tickets",
  "/dashboard/actions": "Actions",
  "/dashboard/integrations": "Integrations",
  "/dashboard/api": "Developer API",
  "/dashboard/settings": "Settings",
  "/dashboard/admin": "Administration",
  "/dashboard/docs": "Docs",
};

function titleCase(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * A readable name for any dashboard route.
 *
 * Detail pages carry a UUID that would render as an unreadable tab, so they
 * fall back to their section name; the caller replaces it with the real page
 * title once the document has one.
 */
export function routeLabel(pathname: string) {
  const clean = pathname.replace(/\/+$/, "") || "/dashboard";
  const known = STATIC_LABELS[clean];
  if (known) return known;

  const segments = clean.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const isIdLike = /^[0-9a-f-]{8,}$/i.test(last) || /^\d+$/.test(last);
  if (isIdLike && segments.length > 1) {
    const parent = `/${segments.slice(0, -1).join("/")}`;
    return STATIC_LABELS[parent] ?? titleCase(parent.split("/").pop() ?? "");
  }
  return titleCase(last);
}

/**
 * Adds a tab, or focuses the existing one.
 *
 * Revisiting a route must not duplicate it - that is what makes the strip feel
 * like tabs rather than history.
 */
export function openTab(tabs: DashboardTab[], tab: DashboardTab) {
  const existing = tabs.findIndex((item) => item.href === tab.href);
  if (existing >= 0) {
    // Keep its position, but take a better label if one has arrived.
    const next = [...tabs];
    next[existing] = { ...next[existing], label: tab.label };
    return next;
  }
  const next = [...tabs, tab];
  if (next.length <= MAX_TABS) return next;
  // Drop the oldest closable tab rather than the pinned first one.
  const oldest = next.findIndex((item) => item.href !== HOME_TAB.href);
  if (oldest >= 0) next.splice(oldest, 1);
  return next;
}

/**
 * Removes a tab and says where to navigate afterwards.
 *
 * Closing an inactive tab must not move the user, which is what browser tabs
 * do and the easiest part to get wrong.
 */
export function closeTab(
  tabs: DashboardTab[],
  href: string,
  activeHref: string,
): { tabs: DashboardTab[]; nextHref: string } {
  if (href === HOME_TAB.href) return { tabs, nextHref: activeHref };
  const index = tabs.findIndex((item) => item.href === href);
  if (index < 0) return { tabs, nextHref: activeHref };

  const remaining = tabs.filter((item) => item.href !== href);
  if (href !== activeHref) return { tabs: remaining, nextHref: activeHref };

  // Focus the neighbour on the right, matching every browser.
  const neighbour = tabs[index + 1] ?? tabs[index - 1] ?? HOME_TAB;
  return { tabs: remaining, nextHref: neighbour.href };
}
