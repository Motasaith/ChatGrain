import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  Bot,
  CircleAlert,
  Clock3,
  Database,
  ExternalLink,
  FileText,
  HardDrive,
  MessageSquareText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { desc, inArray, sql } from "drizzle-orm";
import { AdminControls } from "@/components/app/admin-controls";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import {
  auditLogs,
  crawlJobs,
  systemLogs,
  systemState,
  users,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type SystemOverview = {
  users: number;
  workspaces: number;
  agents: number;
  sources: number;
  documents: number;
  chunks: number;
  conversations: number;
  messages: number;
  queuedJobs: number;
  failedJobs: number;
  databaseBytes: number;
  workerHealthy: boolean;
};

type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  level: string;
  count: string;
  lastSeen: string;
  permalink: string;
};

function formatBytes(input: number) {
  if (!Number.isFinite(input) || input <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(input) / Math.log(1024)),
  );
  return `${(input / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function loadSentryIssues() {
  const configured = Boolean(process.env.SENTRY_DSN);
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) {
    return {
      configured,
      connected: false,
      issues: [] as SentryIssue[],
      message: "Add SENTRY_AUTH_TOKEN with event:read scope to show issues here.",
    };
  }

  const base = (process.env.SENTRY_API_BASE_URL ?? "https://de.sentry.io").replace(
    /\/$/,
    "",
  );
  const org = process.env.SENTRY_ORG ?? "bina-codes";
  const project = process.env.SENTRY_PROJECT ?? "javascript-nextjs";
  try {
    const response = await fetch(
      `${base}/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/?limit=10`,
      {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    if (!response.ok) {
      return {
        configured,
        connected: false,
        issues: [] as SentryIssue[],
        message: `Sentry returned HTTP ${response.status}. Check the API base URL and token scope.`,
      };
    }
    return {
      configured,
      connected: true,
      issues: (await response.json()) as SentryIssue[],
      message: null,
    };
  } catch (error) {
    return {
      configured,
      connected: false,
      issues: [] as SentryIssue[],
      message: error instanceof Error ? error.message : "Sentry is unavailable.",
    };
  }
}

async function loadAdminData() {
  const overviewRows = await db.execute<SystemOverview>(sql`
    select
      (select count(*)::int from users) as users,
      (select count(*)::int from workspaces) as workspaces,
      (select count(*)::int from agents) as agents,
      (select count(*)::int from sources) as sources,
      (select count(*)::int from documents) as documents,
      (select count(*)::int from chunks) as chunks,
      (select count(*)::int from conversations) as conversations,
      (select count(*)::int from messages) as messages,
      (select count(*)::int from crawl_jobs where status = 'queued') as "queuedJobs",
      (select count(*)::int from crawl_jobs where status = 'failed') as "failedJobs",
      pg_database_size(current_database())::bigint as "databaseBytes",
      exists(
        select 1
        from system_state
        where key = 'worker'
          and updated_at > now() - interval '15 seconds'
      ) as "workerHealthy"
  `);
  const overview = overviewRows[0];

  const tableSizes = await db.execute<{
    tableName: string;
    totalBytes: number;
    dataBytes: number;
    indexBytes: number;
  }>(sql`
    select
      relname as "tableName",
      pg_total_relation_size(relid)::bigint as "totalBytes",
      pg_relation_size(relid)::bigint as "dataBytes",
      pg_indexes_size(relid)::bigint as "indexBytes"
    from pg_catalog.pg_statio_user_tables
    order by pg_total_relation_size(relid) desc
    limit 12
  `);

  const [recentUsers, recentJobs, recentAudit, recentSystemLogs, states, sentry] =
    await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          lastSeenAt: users.lastSeenAt,
          retentionExempt: users.retentionExempt,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.lastSeenAt))
        .limit(10),
      db
        .select()
        .from(crawlJobs)
        .orderBy(desc(crawlJobs.updatedAt))
        .limit(10),
      db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(12),
      db
        .select()
        .from(systemLogs)
        .orderBy(desc(systemLogs.createdAt))
        .limit(12),
      db
        .select()
        .from(systemState)
        .where(inArray(systemState.key, ["worker", "retention"])),
      loadSentryIssues(),
    ]);

  return {
    overview,
    tableSizes,
    recentUsers,
    recentJobs,
    recentAudit,
    recentSystemLogs,
    states,
    sentry,
  };
}

export default async function AdminPage() {
  const context = await getWorkspaceContext();
  if (!context.isAdmin) notFound();
  const data = await loadAdminData();
  const workerState = data.states.find((state) => state.key === "worker");
  const retentionState = data.states.find((state) => state.key === "retention");
  const workerHealthy = data.overview.workerHealthy;
  const stats = [
    ["Users", data.overview.users, Users],
    ["Workspaces", data.overview.workspaces, ShieldCheck],
    ["Agents", data.overview.agents, Bot],
    ["Knowledge chunks", data.overview.chunks, FileText],
    ["Conversations", data.overview.conversations, MessageSquareText],
    ["Database", formatBytes(Number(data.overview.databaseBytes)), Database],
  ] as const;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Administration</span>
          <h1>System operations</h1>
          <p>Live database, worker, retention, audit, and error telemetry.</p>
        </div>
        <span className={`admin-health-pill ${workerHealthy ? "healthy" : ""}`}>
          <Activity size={14} />
          Worker {workerHealthy ? "online" : "stale"}
        </span>
      </div>

      <div className="admin-stats-grid">
        {stats.map(([label, value, Icon]) => (
          <article key={label}>
            <span><Icon size={16} /></span>
            <small>{label}</small>
            <strong>{typeof value === "number" ? value.toLocaleString() : value}</strong>
          </article>
        ))}
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
            <div><dt>Worker heartbeat</dt><dd>{workerState ? formatDate(workerState.updatedAt) : "Never"}</dd></div>
            <div><dt>Queued jobs</dt><dd>{data.overview.queuedJobs}</dd></div>
            <div><dt>Failed jobs</dt><dd className={data.overview.failedJobs ? "warning" : ""}>{data.overview.failedJobs}</dd></div>
            <div><dt>Last retention run</dt><dd>{retentionState ? formatDate(retentionState.updatedAt) : "Not run"}</dd></div>
            <div><dt>Retention window</dt><dd>{process.env.INACTIVE_USER_RETENTION_DAYS ?? "30"} days</dd></div>
          </dl>
        </section>

        <AdminControls />
      </div>

      <section className="app-card admin-table-card">
        <div className="app-card-head">
          <div>
            <h2>PostgreSQL storage</h2>
            <p>Actual database, table, TOAST, and index usage inside the Docker volume.</p>
          </div>
          <HardDrive size={18} />
        </div>
        <div className="admin-table-scroll">
          <table>
            <thead><tr><th>Table</th><th>Data</th><th>Indexes</th><th>Total</th></tr></thead>
            <tbody>
              {data.tableSizes.map((table) => (
                <tr key={table.tableName}>
                  <td><code>{table.tableName}</code></td>
                  <td>{formatBytes(Number(table.dataBytes))}</td>
                  <td>{formatBytes(Number(table.indexBytes))}</td>
                  <td><b>{formatBytes(Number(table.totalBytes))}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="admin-note">
          PostgreSQL size is the useful application measurement. On the VPS,
          <code>docker system df -v</code> shows the complete Docker volume and image usage.
        </p>
      </section>

      <div className="admin-two-column">
        <section className="app-card admin-list-card">
          <div className="app-card-head"><div><h2>Recent users</h2><p>Activity used by the retention policy.</p></div><Users size={18} /></div>
          <div className="admin-list">
            {data.recentUsers.map((user) => (
              <div key={user.id}>
                <span className="admin-list-icon">{user.name.slice(0, 1).toUpperCase()}</span>
                <span><b>{user.name}</b><small>{user.email}</small></span>
                <span className="admin-list-meta">{user.retentionExempt ? "Exempt" : formatDate(user.lastSeenAt)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="app-card admin-list-card">
          <div className="app-card-head"><div><h2>Recent crawl jobs</h2><p>Latest worker activity across all workspaces.</p></div><Clock3 size={18} /></div>
          <div className="admin-list">
            {data.recentJobs.map((job) => (
              <div key={job.id}>
                <span className={`admin-job-dot ${job.status}`} />
                <span><b>{job.status}</b><small>{job.id}</small></span>
                <span className="admin-list-meta">{job.pagesProcessed}/{job.pagesDiscovered} pages</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="admin-two-column">
        <section className="app-card admin-list-card">
          <div className="app-card-head"><div><h2>Audit trail</h2><p>Who changed what in Docent.</p></div><ShieldCheck size={18} /></div>
          <div className="admin-log-list">
            {data.recentAudit.length ? data.recentAudit.map((entry) => (
              <div key={entry.id}>
                <span>{entry.action}</span>
                <b>{entry.message}</b>
                <small>{entry.actorEmail ?? "System"} · {formatDate(entry.createdAt)}</small>
              </div>
            )) : <p className="admin-empty">Audit events will appear after application changes.</p>}
          </div>
        </section>

        <section className="app-card admin-list-card">
          <div className="app-card-head"><div><h2>Operational logs</h2><p>Durable worker and maintenance events.</p></div><FileText size={18} /></div>
          <div className="admin-log-list">
            {data.recentSystemLogs.length ? data.recentSystemLogs.map((entry) => (
              <div key={entry.id}>
                <span className={`log-level-${entry.level}`}>{entry.level}</span>
                <b>{entry.message}</b>
                <small>{entry.service} · {formatDate(entry.createdAt)}</small>
              </div>
            )) : <p className="admin-empty">Worker events will appear after the new migration is applied.</p>}
          </div>
        </section>
      </div>

      <section className="app-card admin-sentry-card">
        <div className="app-card-head">
          <div>
            <h2>Sentry issues</h2>
            <p>Unhandled application errors from the configured Sentry project.</p>
          </div>
          <span className={data.sentry.connected ? "connected" : ""}>
            {data.sentry.connected ? "Connected" : data.sentry.configured ? "DSN active" : "Not configured"}
          </span>
        </div>
        {data.sentry.message ? (
          <div className="admin-sentry-message"><CircleAlert size={16} /><span>{data.sentry.message}</span></div>
        ) : null}
        {data.sentry.issues.length ? (
          <div className="admin-log-list">
            {data.sentry.issues.map((issue) => (
              <Link href={issue.permalink} key={issue.id} target="_blank">
                <span className={`log-level-${issue.level}`}>{issue.shortId}</span>
                <b>{issue.title}</b>
                <small>{issue.count} events · last seen {formatDate(issue.lastSeen)} <ExternalLink size={11} /></small>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}
