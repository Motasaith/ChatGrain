import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import {
  Activity,
  BarChart3,
  Bot,
  Clock3,
  FileText,
  History,
  Server,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { AgentsTab, PeopleTab, WorkspacesTab } from "./directory-tabs";
import { AuditTab, JobsTab, LogsTab, SessionsTab } from "./activity-tabs";
import { OverviewTab } from "./overview-tab";
import { SystemTab } from "./system-tab";
import { type AdminSearchParams, adminHref, readParam } from "./shared";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3, description: "Growth, usage and anything that needs a look." },
  { id: "workspaces", label: "Workspaces", icon: ShieldCheck, description: "Every account here, and what it is allowed to do." },
  { id: "agents", label: "Agents", icon: Bot, description: "Every agent on this installation." },
  { id: "people", label: "People", icon: Users, description: "Accounts, platform roles and retention." },
  { id: "jobs", label: "Crawl jobs", icon: Clock3, description: "Crawl and indexing work, and what went wrong." },
  { id: "sessions", label: "Editing sessions", icon: History, description: "Administrator edits, each one a restore point." },
  { id: "audit", label: "Audit trail", icon: ScrollText, description: "Who changed what, and when." },
  { id: "logs", label: "Logs", icon: FileText, description: "Worker and maintenance events." },
  { id: "system", label: "System", icon: Server, description: "Storage, releases and error tracking." },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * The counts on the tab rail, so what needs attention is visible from
 * whichever tab is open. One round trip, and all of it answered by indexes or
 * small tables.
 */
async function loadBadges() {
  const [row] = await db.execute<{
    failedJobs: number;
    openSessions: number;
    erroringAgents: number;
    errorLogs: number;
    workerHealthy: boolean;
  }>(sql`
    select
      (select count(*)::int from crawl_jobs where status = 'failed'
        and updated_at > now() - interval '1 day') as "failedJobs",
      (select count(*)::int from admin_sessions where status = 'open') as "openSessions",
      (select count(*)::int from agents where status = 'error') as "erroringAgents",
      (select count(*)::int from system_logs where level = 'error'
        and created_at > now() - interval '1 day') as "errorLogs",
      exists(
        select 1 from system_state
        where key = 'worker' and updated_at > now() - interval '15 seconds'
      ) as "workerHealthy"
  `);
  return row;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<AdminSearchParams>;
}) {
  const context = await getWorkspaceContext();
  if (!context.isAdmin) notFound();
  const params = await searchParams;
  const tab = (TABS.find((entry) => entry.id === readParam(params, "tab"))?.id ?? "overview") as TabId;
  const current = TABS.find((entry) => entry.id === tab)!;
  const badges = await loadBadges();

  const badge: Partial<Record<TabId, { count: number; tone: "bad" | "warn" }>> = {
    jobs: { count: badges.failedJobs, tone: "bad" },
    agents: { count: badges.erroringAgents, tone: "warn" },
    sessions: { count: badges.openSessions, tone: "warn" },
    logs: { count: badges.errorLogs, tone: "bad" },
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Administration · {current.label}</span>
          <h1>System operations</h1>
          <p>{current.description}</p>
        </div>
        <span className={`admin-health-pill ${badges.workerHealthy ? "healthy" : ""}`}>
          <Activity size={14} />
          Worker {badges.workerHealthy ? "online" : "stale"}
        </span>
      </div>

      <div className="admin-console">
        <nav aria-label="Admin sections" className="admin-rail">
          {TABS.map((entry) => {
            const count = badge[entry.id]?.count ?? 0;
            return (
              <Link
                aria-current={entry.id === tab ? "page" : undefined}
                href={adminHref(entry.id)}
                key={entry.id}
              >
                <entry.icon size={16} />
                <span>{entry.label}</span>
                {count ? (
                  <b className={`admin-rail-badge ${badge[entry.id]?.tone}`} title={`${count} need attention`}>
                    {count > 99 ? "99+" : count}
                  </b>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="admin-console-main">
          {tab === "overview" ? <OverviewTab /> : null}
          {tab === "workspaces" ? <WorkspacesTab params={params} /> : null}
          {tab === "agents" ? <AgentsTab params={params} /> : null}
          {tab === "people" ? (
            <PeopleTab canChangeRoles={context.platformRole === "superadmin"} params={params} />
          ) : null}
          {tab === "jobs" ? <JobsTab params={params} /> : null}
          {tab === "sessions" ? <SessionsTab params={params} /> : null}
          {tab === "audit" ? <AuditTab params={params} /> : null}
          {tab === "logs" ? <LogsTab params={params} /> : null}
          {tab === "system" ? <SystemTab /> : null}
        </div>
      </div>
    </>
  );
}
