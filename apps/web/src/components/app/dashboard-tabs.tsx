"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  HOME_TAB,
  closeTab,
  openTab,
  routeLabel,
  type DashboardTab,
} from "@/lib/dashboard/tabs";

const STORAGE_KEY = "chatgrain:dashboard-tabs";

function persist(tabs: DashboardTab[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // Private browsing can refuse storage. Tabs still work for this visit.
  }
}

/**
 * A browser-style tab strip for the dashboard.
 *
 * Each tab is a route rather than a suspended page: switching re-renders the
 * destination instead of restoring it. Keeping several routes mounted at once
 * is not something the App Router supports, and faking it would leave every
 * dashboard page fetching in the background.
 */
export function DashboardTabs() {
  const pathname = usePathname();
  const router = useRouter();

  // Lazy initial state: reading storage in an effect would render one frame
  // without the tabs, so the strip would flicker on every reload.
  const [tabs, setTabs] = useState<DashboardTab[]>(() => {
    if (typeof window === "undefined") return [HOME_TAB];
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      const parsed = stored ? (JSON.parse(stored) as DashboardTab[]) : null;
      return Array.isArray(parsed) && parsed.length ? parsed : [HOME_TAB];
    } catch {
      return [HOME_TAB];
    }
  });

  // Adjusting state during render rather than in an effect: React re-renders
  // immediately without committing the intermediate result, so the strip never
  // paints a frame missing the tab you just opened.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (pathname?.startsWith("/dashboard")) {
      setTabs(
        openTab(tabs, { href: pathname, label: routeLabel(pathname) }),
      );
    }
  }

  const serialised = JSON.stringify(tabs);
  useEffect(() => {
    persist(JSON.parse(serialised) as DashboardTab[]);
  }, [serialised]);

  function handleClose(event: React.MouseEvent, href: string) {
    // The close control sits inside the tab's own link.
    event.preventDefault();
    event.stopPropagation();
    const result = closeTab(tabs, href, pathname ?? HOME_TAB.href);
    setTabs(result.tabs);
    persist(result.tabs);
    if (result.nextHref !== pathname) router.push(result.nextHref);
  }

  // One tab is just the page you are on; the strip only earns its space once
  // there is something to switch between.
  if (tabs.length <= 1) return null;

  return (
    <nav aria-label="Open pages" className="dashboard-tabs">
      {tabs.map((item) => {
        const active = item.href === pathname;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={active ? "dashboard-tab active" : "dashboard-tab"}
            href={item.href}
            key={item.href}
            title={item.href}
          >
            <span>{item.label}</span>
            {item.href === HOME_TAB.href ? null : (
              <button
                aria-label={`Close ${item.label}`}
                onClick={(event) => handleClose(event, item.href)}
                type="button"
              >
                <X size={13} />
              </button>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
