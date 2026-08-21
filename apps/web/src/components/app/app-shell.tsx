"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { CommandPalette } from "@/components/app/command-palette";
import { DashboardTabs } from "@/components/app/dashboard-tabs";
import { SystemStatus } from "@/components/app/system-status";
import { OperatorPresence } from "@/components/app/operator-presence";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Braces,
  ChevronDown,
  CircleHelp,
  Cog,
  ContactRound,
  Inbox,
  LayoutDashboard,
  Plus,
  Plug,
  Shield,
  TicketCheck,
} from "lucide-react";
import { Logo } from "@/components/logo";

const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/agents", label: "Agents", icon: Bot },
  { href: "/dashboard/activity", label: "Activity", icon: Inbox },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/leads", label: "Leads", icon: ContactRound },
  { href: "/dashboard/tickets", label: "Tickets", icon: TicketCheck },
];

const buildNavigation = [
  { href: "/dashboard/actions", label: "Actions", icon: Braces },
  { href: "/dashboard/integrations", label: "Integrations", icon: Plug },
  { href: "/dashboard/api", label: "Developer API", icon: Boxes },
];

export function AppShell({
  children,
  identity,
  clerkEnabled,
  pendingHandoffs,
}: {
  children: React.ReactNode;
  identity: {
    name: string;
    email: string;
    isAdmin: boolean;
    workspaceName: string;
  };
  clerkEnabled: boolean;
  pendingHandoffs: number;
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
          <span className="workspace-avatar">
            {identity.workspaceName.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <b>{identity.workspaceName}</b>
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
              {item.href === "/dashboard/activity" && pendingHandoffs > 0 ? (
                <em className="sidebar-count">
                  {pendingHandoffs > 99 ? "99+" : pendingHandoffs}
                </em>
              ) : null}
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
          {identity.isAdmin ? (
            <>
              <span className="sidebar-section-label">System</span>
              <Link
                className={
                  pathname === "/dashboard/admin" ||
                  pathname.startsWith("/dashboard/admin/")
                    ? "active"
                    : ""
                }
                href="/dashboard/admin"
              >
                <Shield size={17} />
                Administration
              </Link>
            </>
          ) : null}
        </nav>

        <div className="sidebar-local">
          <div>
            <span className="local-status-dot" />
            <b>Local stack</b>
          </div>
          <small>Postgres · Worker · Local embeddings</small>
          <Link href="/dashboard/settings">
            Configure <Cog size={12} />
          </Link>
        </div>

        <div className="sidebar-profile">
          {clerkEnabled ? (
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "clerk-sidebar-avatar",
                },
              }}
            />
          ) : (
            <span className="profile-avatar">{initials}</span>
          )}
          <span>
            <b>{identity.name}</b>
            <small>{identity.email}</small>
          </span>
          <ChevronDown size={14} />
        </div>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <CommandPalette />
          <div className="app-header-actions">
            <Link
              className="header-notification"
              href="/dashboard/activity"
              aria-label={`${pendingHandoffs} pending handoff requests`}
            >
              <Bell size={18} />
              {pendingHandoffs > 0 ? (
                <i>{pendingHandoffs > 99 ? "99+" : pendingHandoffs}</i>
              ) : null}
            </Link>
            <Link href="/dashboard/docs" aria-label="Documentation">
              <CircleHelp size={18} />
            </Link>
            <SystemStatus />
            <Link className="header-build-button" href="/dashboard/agents/new">
              <Plus size={15} />
              New agent
            </Link>
          </div>
        </header>
        <OperatorPresence />
        <DashboardTabs />
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
