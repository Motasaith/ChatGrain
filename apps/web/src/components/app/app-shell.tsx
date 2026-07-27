"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  Braces,
  ChevronDown,
  CircleHelp,
  Cog,
  ContactRound,
  Inbox,
  LayoutDashboard,
  Plug,
  Search,
  Sparkles,
} from "lucide-react";
import { Logo } from "@/components/logo";

const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/agents", label: "Agents", icon: Bot },
  { href: "/dashboard/activity", label: "Activity", icon: Inbox },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/leads", label: "Leads", icon: ContactRound },
];

const buildNavigation = [
  { href: "/dashboard/actions", label: "Actions", icon: Braces },
  { href: "/dashboard/integrations", label: "Integrations", icon: Plug },
  { href: "/dashboard/api", label: "Developer API", icon: Boxes },
];

export function AppShell({
  children,
  identity,
}: {
  children: React.ReactNode;
  identity: { name: string; email: string };
}) {
  const pathname = usePathname();
  const initials = identity.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <div className="sidebar-logo">
          <Logo inverse />
        </div>
        <button className="workspace-switcher" type="button">
          <span className="workspace-avatar">M</span>
          <span>
            <b>My workspace</b>
            <small>Community</small>
          </span>
          <ChevronDown size={14} />
        </button>

        <nav className="sidebar-nav" aria-label="Product">
          <span className="sidebar-section-label">Workspace</span>
          {navigation.map((item) => (
            <Link
              className={
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))
                  ? "active"
                  : ""
              }
              key={item.href}
              href={item.href}
            >
              <item.icon size={17} />
              {item.label}
            </Link>
          ))}
          <span className="sidebar-section-label">Build</span>
          {buildNavigation.map((item) => (
            <Link
              className={
                pathname === item.href || pathname.startsWith(`${item.href}/`)
                  ? "active"
                  : ""
              }
              key={item.href}
              href={item.href}
            >
              <item.icon size={17} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-local">
          <div>
            <span className="local-status-dot" />
            <b>Local stack</b>
          </div>
          <small>Postgres · Worker · Local AI</small>
          <Link href="/dashboard/settings">
            Configure <Cog size={12} />
          </Link>
        </div>

        <div className="sidebar-profile">
          <span className="profile-avatar">{initials}</span>
          <span>
            <b>{identity.name}</b>
            <small>{identity.email}</small>
          </span>
          <ChevronDown size={14} />
        </div>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <div className="app-search">
            <Search size={16} />
            <span>Search agents, conversations, and sources</span>
            <kbd>⌘ K</kbd>
          </div>
          <div className="app-header-actions">
            <Link href="/dashboard/docs" aria-label="Documentation">
              <CircleHelp size={18} />
            </Link>
            <Link href="/api/health" aria-label="System status">
              <Activity size={18} />
            </Link>
            <Link className="header-build-button" href="/dashboard/agents/new">
              <Sparkles size={15} />
              New agent
            </Link>
          </div>
        </header>
        <div className="app-page">{children}</div>
      </div>

      <nav className="mobile-app-nav" aria-label="Mobile navigation">
        {navigation.slice(0, 5).map((item) => (
          <Link
            className={
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))
                ? "active"
                : ""
            }
            key={item.href}
            href={item.href}
          >
            <item.icon size={19} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
