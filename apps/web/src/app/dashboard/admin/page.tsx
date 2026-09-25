import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import {
  Activity,
  BarChart3,
  Bot,
  Clock3,
  FileText,
  Gauge,
  History,
  Inbox,
  Server,
  ScrollText,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import { getMaintenanceState } from "@/lib/admin/maintenance-mode";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { SANDBOX_CHANNEL } from "@/lib/chat/sandbox";
import { db } from "@/lib/db/client";
import { AgentsTab, PeopleTab, WorkspacesTab } from "./directory-tabs";
import { AuditTab, JobsTab, LogsTab, SessionsTab } from "./activity-tabs";
import { PersonDetail, WorkspaceDetail } from "./detail-tabs";
import { QualityTab, WaitingTab } from "./insight-tabs";
import { OverviewTab } from "./overview-tab";
import { SystemTab } from "./system-tab";
import { type AdminSearchParams, adminHref, readParam } from "./shared";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3, description: "Growth, usage and anything that needs a look." },
  { id: "waiting", label: "Waiting", icon: Inbox, description: "Visitors waiting on a person, in every workspace." },
  { id: "quality", label: "Quality", icon: Gauge, description: "Whether agents answer from evidence, how fast, and how it is received." },
  { id: "workspaces", label: "Workspaces", icon: ShieldCheck, description: "Every account here, and what it is allowed to do." },
  { id: "agents", label: "Agents", icon: Bot, description: "Every agent on this installation." },
  { id: "people", label: "People", icon: Users, description: "Accounts, platform roles and retention." },
  { id: "jobs", label: "Crawl jobs", icon: Clock3, description: "Crawl and indexing work, and what went wrong." },
  { id: "sessions", label: "Editing sessions", icon: History, description: "Administrator edits, each one a restore point." },
  { id: "audit", label: "Audit trail", icon: ScrollText, description: "Who changed what, and when." },
  { id: "logs", label: "Logs", icon: FileText, description: "Worker and maintenance events." },
  { id: "system", label: "System", icon: Server, description: "Maintenance, e-mail, workers, retention, storage and releases." },
] as const;

/**
 * Pages reached from a row rather than from the rail. The rail keeps the
 * parent list highlighted, so it is always clear how to get back.
 */
const DETAILS = {
  workspace: { parent: "workspaces", description: "One workspace: members, agents, usage and history." },
  person: { parent: "people", description: "One person: where they belong and what they have done." },
} as const;

type TabId = (typeof TABS)[number]["id"];
type DetailId = keyof typeof DETAILS;

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
    waiting: number;
    workerHealthy: boolean;
  }>(sql`
    select
      (select count(*)::int from crawl_jobs where status = 'failed'
        and updated_at > now() - interval '1 day') as "failedJobs",
      (select count(*)::int from admin_sessions where status = 'open') as "openSessions",
      (select count(*)::int from agents where status = 'error') as "erroringAgents",
      (select count(*)::int from system_logs where level = 'error'
        and created_at > now() - interval '1 day') as "errorLogs",
      (select count(*)::int from conversations
        where status = 'escalated' and channel <> ${SANDBOX_CHANNEL})
        + (select count(*)::int from tickets where status in ('open', 'pending')) as waiting,
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
  const requested = readParam(params, "tab");
  const detail = requested in DETAILS ? (requested as DetailId) : null;
  const tab = (detail
    ? DETAILS[detail].parent
    : (TABS.find((entry) => entry.id === requested)?.id ?? "overview")) as TabId;
  const current = TABS.find((entry) => entry.id === tab)!;
  const [badges, maintenance] = await Promise.all([loadBadges(), getMaintenanceState()]);
  const canChangeRoles = context.platformRole === "superadmin";
  const id = readParam(params, "id");

  const badge: Partial<Record<TabId, { count: number; tone: "bad" | "warn" }>> = {
    waiting: { count: badges.waiting, tone: "warn" },
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
          <p>{detail ? DETAILS[detail].description : current.description}</p>
        </div>
        <span className={`admin-health-pill ${badges.workerHealthy ? "healthy" : ""}`}>
          <Activity size={14} />
          Worker {badges.workerHealthy ? "online" : "stale"}
        </span>
      </div>

      {maintenance.enabled ? (
        <Link className="admin-maintenance-banner" href={adminHref("system")}>
          <Wrench size={15} />
          <span>
            <b>Maintenance mode is on.</b> Customers see a holding page; you are seeing the dashboard because you are an
            administrator.
          </span>
          <span>Turn it off</span>
        </Link>
      ) : null}

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
          {detail === "workspace" ? <WorkspaceDetail canChangeRoles={canChangeRoles} id={id} /> : null}
          {detail === "person" ? <PersonDetail canChangeRoles={canChangeRoles} id={id} /> : null}
          {!detail && tab === "overview" ? <OverviewTab /> : null}
          {!detail && tab === "waiting" ? <WaitingTab params={params} /> : null}
          {!detail && tab === "quality" ? <QualityTab params={params} /> : null}
          {!detail && tab === "workspaces" ? <WorkspacesTab params={params} /> : null}
          {!detail && tab === "agents" ? <AgentsTab params={params} /> : null}
          {!detail && tab === "people" ? <PeopleTab canChangeRoles={canChangeRoles} params={params} /> : null}
          {!detail && tab === "jobs" ? <JobsTab params={params} /> : null}
          {!detail && tab === "sessions" ? <SessionsTab params={params} /> : null}
          {!detail && tab === "audit" ? <AuditTab params={params} /> : null}
          {!detail && tab === "logs" ? <LogsTab params={params} /> : null}
          {!detail && tab === "system" ? <SystemTab adminEmail={context.email} /> : null}
        </div>
      </div>
    </>
  );
}
