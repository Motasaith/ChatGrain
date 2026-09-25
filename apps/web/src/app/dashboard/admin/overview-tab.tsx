import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronRight,
  Database,
  MessageSquareText,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { AdminAutoRefresh } from "@/components/app/admin-auto-refresh";
import { AdminControls } from "@/components/app/admin-controls";
import { AdminDailyBars } from "@/components/app/admin-daily-bars";
import { getMaintenanceState } from "@/lib/admin/maintenance-mode";
import { SANDBOX_CHANNEL } from "@/lib/chat/sandbox";
import { db } from "@/lib/db/client";
import { adminHref, formatBytes, formatDate } from "./shared";
import { AdminPanel, StatTile } from "./ui";

const CHART_DAYS = 14;
// Today plus the thirteen days before it.
const chartWindow = sql.raw(`interval '${CHART_DAYS - 1} days'`);

type Overview = {
  users: number;
  usersNew24h: number;
  usersNew7d: number;
  usersActive24h: number;
  admins: number;
  workspaces: number;
  workspacesSuspended: number;
  agents: number;
  agentsReady: number;
  agentsTraining: number;
  agentsError: number;
  sources: number;
  documents: number;
  chunks: number;
  conversations: number;
  conversations24h: number;
  conversationsEscalated: number;
  messages: number;
  queuedJobs: number;
  runningJobs: number;
  failedJobs: number;
  failedJobs24h: number;
  openSessions: number;
  openTickets: number;
  databaseBytes: number;
  workerHealthy: boolean;
  workerSeenAt: string | null;
  retentionRanAt: string | null;
};

type Day = { day: string; signups: number; conversations: number; answers: number };

async function loadOverview() {
  // Test chats from the dashboard sandbox are left out of every conversation
  // figure: they are the operator talking to themselves, not demand.
  const [overviewRows, series, topWorkspaces] = await Promise.all([
    db.execute<Overview>(sql`
      select
        (select count(*)::int from users) as users,
        (select count(*)::int from users where created_at > now() - interval '1 day') as "usersNew24h",
        (select count(*)::int from users where created_at > now() - interval '7 days') as "usersNew7d",
        (select count(*)::int from users where last_seen_at > now() - interval '1 day') as "usersActive24h",
        (select count(*)::int from users where platform_role <> 'member') as admins,
        (select count(*)::int from workspaces) as workspaces,
        (select count(*)::int from workspaces where suspended_at is not null) as "workspacesSuspended",
        (select count(*)::int from agents) as agents,
        (select count(*)::int from agents where status = 'ready') as "agentsReady",
        (select count(*)::int from agents where status = 'training') as "agentsTraining",
        (select count(*)::int from agents where status = 'error') as "agentsError",
        (select count(*)::int from sources) as sources,
        (select count(*)::int from documents) as documents,
        (select count(*)::int from chunks) as chunks,
        (select count(*)::int from conversations where channel <> ${SANDBOX_CHANNEL}) as conversations,
        (select count(*)::int from conversations
          where channel <> ${SANDBOX_CHANNEL} and created_at > now() - interval '1 day') as "conversations24h",
        (select count(*)::int from conversations
          where channel <> ${SANDBOX_CHANNEL} and status = 'escalated') as "conversationsEscalated",
        (select count(*)::int from messages) as messages,
        (select count(*)::int from crawl_jobs where status = 'queued') as "queuedJobs",
        (select count(*)::int from crawl_jobs where status = 'running') as "runningJobs",
        (select count(*)::int from crawl_jobs where status = 'failed') as "failedJobs",
        (select count(*)::int from crawl_jobs
          where status = 'failed' and updated_at > now() - interval '1 day') as "failedJobs24h",
        (select count(*)::int from admin_sessions where status = 'open') as "openSessions",
        (select count(*)::int from tickets where status in ('open', 'pending')) as "openTickets",
        pg_database_size(current_database())::bigint as "databaseBytes",
        exists(
          select 1 from system_state
          where key = 'worker' and updated_at > now() - interval '15 seconds'
        ) as "workerHealthy",
        (select updated_at from system_state where key = 'worker') as "workerSeenAt",
        (select updated_at from system_state where key = 'retention') as "retentionRanAt"
    `),
    // Whole UTC days, grouped once per table rather than counted per day, and
    // joined onto a generated calendar so a quiet day is a zero, not a gap.
    db.execute<Day>(sql`
      with days as (
        select to_char(day, 'YYYY-MM-DD') as day
        from generate_series(
          date_trunc('day', now() at time zone 'utc') - ${chartWindow},
          date_trunc('day', now() at time zone 'utc'),
          interval '1 day'
        ) as day
      ),
      signups as (
        select to_char(created_at at time zone 'utc', 'YYYY-MM-DD') as day, count(*)::int as n
        from users
        where created_at at time zone 'utc' >= date_trunc('day', now() at time zone 'utc') - ${chartWindow}
        group by 1
      ),
      chats as (
        select to_char(created_at at time zone 'utc', 'YYYY-MM-DD') as day, count(*)::int as n
        from conversations
        where channel <> ${SANDBOX_CHANNEL}
          and created_at at time zone 'utc' >= date_trunc('day', now() at time zone 'utc') - ${chartWindow}
        group by 1
      ),
      answers as (
        select day, sum(calls)::int as n
        from workspace_usage
        where kind = 'generation'
          and day >= to_char(now() at time zone 'utc' - ${chartWindow}, 'YYYY-MM-DD')
        group by day
      )
      select
        days.day,
        coalesce(signups.n, 0) as signups,
        coalesce(chats.n, 0) as conversations,
        coalesce(answers.n, 0) as answers
      from days
      left join signups using (day)
      left join chats using (day)
      left join answers using (day)
      order by days.day
    `),
    db.execute<{ id: string; name: string; answers: number; suspended: boolean }>(sql`
      select w.id, w.name, w.suspended_at is not null as suspended, coalesce(sum(u.calls), 0)::int as answers
      from workspaces w
      join workspace_usage u on u.workspace_id = w.id
      where u.kind = 'generation'
        and u.day >= to_char(now() - interval '30 days', 'YYYY-MM-DD')
      group by w.id
      order by answers desc
      limit 5
    `),
  ]);
  return { overview: overviewRows[0], series: [...series], topWorkspaces: [...topWorkspaces] };
}

export async function OverviewTab() {
  const { overview: o, series, topWorkspaces } = await loadOverview();
  const topMax = Math.max(1, ...topWorkspaces.map((workspace) => workspace.answers));

  const maintenance = await getMaintenanceState();
  const waiting = o.conversationsEscalated + o.openTickets;
  const attention = [
    maintenance.enabled && {
      tone: "warn",
      text: "Maintenance mode is on. Customers cannot use the dashboard.",
      detail: maintenance.by ? `Turned on by ${maintenance.by}` : "Turn it off from System",
      href: adminHref("system"),
    },
    !o.workerHealthy && {
      tone: "bad",
      text: "The crawl worker has not reported in the last 15 seconds.",
      detail: o.workerSeenAt ? `Last heartbeat ${formatDate(o.workerSeenAt)}` : "No heartbeat on record",
      href: adminHref("jobs"),
    },
    o.failedJobs24h > 0 && {
      tone: "bad",
      text: `${o.failedJobs24h} crawl ${o.failedJobs24h === 1 ? "job" : "jobs"} failed in the last day.`,
      detail: `${o.failedJobs} failed in total`,
      href: adminHref("jobs", { status: "failed" }),
    },
    o.agentsError > 0 && {
      tone: "warn",
      text: `${o.agentsError} ${o.agentsError === 1 ? "agent is" : "agents are"} in an error state.`,
      detail: "Their visitors may be getting no answers",
      href: adminHref("agents", { status: "error" }),
    },
    waiting > 0 && {
      tone: "warn",
      text: `${waiting} ${waiting === 1 ? "visitor is" : "visitors are"} waiting on a person.`,
      detail: `${o.conversationsEscalated} handed-off chats · ${o.openTickets} open tickets`,
      href: adminHref("waiting"),
    },
    o.openSessions > 0 && {
      tone: "warn",
      text: `${o.openSessions} administrator editing ${o.openSessions === 1 ? "session is" : "sessions are"} open.`,
      detail: "Changes made there are not reviewed yet",
      href: adminHref("sessions", { status: "open" }),
    },
    o.workspacesSuspended > 0 && {
      tone: "info",
      text: `${o.workspacesSuspended} ${o.workspacesSuspended === 1 ? "workspace is" : "workspaces are"} suspended.`,
      detail: "Check whether any can be restored",
      href: adminHref("workspaces", { state: "suspended" }),
    },
  ].filter(Boolean) as Array<{ tone: string; text: string; detail: string; href: string }>;

  return (
    <>
      <div className="admin-live-row">
        <AdminAutoRefresh seconds={30} />
      </div>
      <div className="admin-stats-grid">
        <StatTile
          href={adminHref("people")}
          hint={`+${o.usersNew24h} today · +${o.usersNew7d} this week`}
          icon={Users}
          label="Users"
          value={o.users}
        />
        <StatTile
          href={adminHref("people")}
          hint={`${o.admins} with platform access`}
          icon={Activity}
          label="Active today"
          value={o.usersActive24h}
        />
        <StatTile
          href={adminHref("workspaces")}
          hint={o.workspacesSuspended ? `${o.workspacesSuspended} suspended` : "None suspended"}
          icon={ShieldCheck}
          label="Workspaces"
          tone={o.workspacesSuspended ? "warn" : undefined}
          value={o.workspaces}
        />
        <StatTile
          href={adminHref("agents")}
          hint={`${o.agentsReady} ready · ${o.agentsTraining} training · ${o.agentsError} failing`}
          icon={Bot}
          label="Agents"
          tone={o.agentsError ? "warn" : undefined}
          value={o.agents}
        />
        <StatTile
          hint={`+${o.conversations24h} today · ${o.conversationsEscalated} waiting on a person`}
          icon={MessageSquareText}
          label="Conversations"
          value={o.conversations}
        />
        <StatTile
          href={adminHref("system")}
          hint={`${o.chunks.toLocaleString()} passages · ${o.documents.toLocaleString()} documents`}
          icon={Database}
          label="Database"
          value={formatBytes(Number(o.databaseBytes))}
        />
      </div>

      <div className="admin-chart-grid">
        <section className="app-card admin-panel">
          <div className="admin-panel-body">
            <AdminDailyBars
              data={series.map((day) => ({ day: day.day, value: day.signups }))}
              label="Sign-ups"
              unit="sign-ups"
              tone="blue"
            />
          </div>
        </section>
        <section className="app-card admin-panel">
          <div className="admin-panel-body">
            <AdminDailyBars
              data={series.map((day) => ({ day: day.day, value: day.conversations }))}
              label="Conversations started"
              unit="conversations"
            />
          </div>
        </section>
        <section className="app-card admin-panel">
          <div className="admin-panel-body">
            <AdminDailyBars
              data={series.map((day) => ({ day: day.day, value: day.answers }))}
              label="Answers generated"
              unit="answers"
              tone="purple"
            />
          </div>
        </section>
      </div>

      <div className="admin-two-column">
        <AdminPanel
          description="Anything here is worth a look before anything else."
          icon={AlertTriangle}
          title="Needs attention"
        >
          {attention.length ? (
            <div className="admin-attention">
              {attention.map((item) => (
                <Link className={`tone-${item.tone}`} href={item.href} key={item.text}>
                  <span>
                    <b>{item.text}</b>
                    <small>{item.detail}</small>
                  </span>
                  <ChevronRight size={15} />
                </Link>
              ))}
            </div>
          ) : (
            <p className="admin-all-clear">
              <ShieldCheck size={16} /> All clear. The worker is running and nothing has failed today.
            </p>
          )}
        </AdminPanel>

        <AdminPanel
          description="Answers generated in the last 30 days."
          icon={TrendingUp}
          title="Busiest workspaces"
        >
          {topWorkspaces.length ? (
            <div className="admin-rank">
              {topWorkspaces.map((workspace) => (
                <div key={workspace.id}>
                  <span>
                    {workspace.name}
                    {workspace.suspended ? <i className="status-pill status-error">suspended</i> : null}
                  </span>
                  <b>{workspace.answers.toLocaleString()}</b>
                  <i style={{ width: `${(workspace.answers / topMax) * 100}%` }} />
                </div>
              ))}
            </div>
          ) : (
            <p className="admin-empty">No answers have been generated in the last 30 days.</p>
          )}
        </AdminPanel>
      </div>

      <div className="admin-status-grid">
        <section className="app-card admin-status-card">
          <div className="app-card-head">
            <div>
              <h2>Runtime health</h2>
              <p>Current queue and maintenance heartbeat.</p>
            </div>
            <Activity size={18} />
          </div>
          <dl>
            <div><dt>Worker heartbeat</dt><dd>{o.workerSeenAt ? formatDate(o.workerSeenAt) : "Never"}</dd></div>
            <div><dt>Queued jobs</dt><dd>{o.queuedJobs}</dd></div>
            <div><dt>Running jobs</dt><dd>{o.runningJobs}</dd></div>
            <div><dt>Failed jobs</dt><dd className={o.failedJobs ? "warning" : ""}>{o.failedJobs}</dd></div>
            <div><dt>Last retention run</dt><dd>{o.retentionRanAt ? formatDate(o.retentionRanAt) : "Not run"}</dd></div>
            <div><dt>Retention window</dt><dd>{process.env.INACTIVE_USER_RETENTION_DAYS ?? "30"} days</dd></div>
          </dl>
        </section>

        <AdminControls />
      </div>
    </>
  );
}
