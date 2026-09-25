import Link from "next/link";
import { sql } from "drizzle-orm";
import { Archive, CircleAlert, Cpu, ExternalLink, HardDrive, Mail } from "lucide-react";
import { AdminEmailTest } from "@/components/app/admin-email-test";
import { AdminMaintenanceToggle } from "@/components/app/admin-maintenance-toggle";
import { ReleasePanel } from "@/components/app/release-panel";
import { getMaintenanceState } from "@/lib/admin/maintenance-mode";
import { retentionPolicy } from "@/lib/admin/retention";
import { db } from "@/lib/db/client";
import { mailerConfigured } from "@/lib/support/mailer";
import { APP_VERSION } from "@/lib/version";
import { formatBytes, formatDate, loadSentryIssues } from "./shared";
import { AdminPanel, When } from "./ui";

type RetentionRow = {
  kind: "auditLogs" | "systemLogs" | "sessionSnapshots" | "inactiveUsers";
  total: number;
  due: number;
  oldest: string | null;
  bytes: number | null;
};

async function loadRetention() {
  const policy = retentionPolicy();
  const [rows, [lastRun]] = await Promise.all([
    db.execute<RetentionRow>(sql`
      select 'auditLogs' as kind, count(*)::int as total,
        count(*) filter (where created_at < now() - make_interval(days => ${policy.auditLogs}))::int as due,
        min(created_at) as oldest, null::bigint as bytes
      from audit_logs
      union all
      select 'systemLogs', count(*)::int,
        count(*) filter (where created_at < now() - make_interval(days => ${policy.systemLogs}))::int,
        min(created_at), null
      from system_logs
      union all
      select 'sessionSnapshots', count(*) filter (where status <> 'expired')::int,
        count(*) filter (where status <> 'expired'
          and started_at < now() - make_interval(days => ${policy.sessionSnapshots}))::int,
        min(started_at) filter (where status <> 'expired'),
        coalesce(sum(pg_column_size(snapshot)) filter (where status <> 'expired'), 0)::bigint
      from admin_sessions
      union all
      select 'inactiveUsers', count(*)::int,
        count(*) filter (where last_seen_at < now() - make_interval(days => ${policy.inactiveUsers})
          and not retention_exempt and platform_role = 'member')::int,
        null, null
      from users
    `),
    db.execute<{ updatedAt: string; value: Record<string, unknown> }>(sql`
      select updated_at as "updatedAt", value from system_state where key = 'retention'
    `),
  ]);
  return { policy, rows: [...rows], lastRun: lastRun ?? null };
}

const RETENTION_LABELS: Record<RetentionRow["kind"], { label: string; unit: string; action: string; env: string }> = {
  auditLogs: { label: "Audit trail", unit: "events", action: "deleted", env: "AUDIT_LOG_RETENTION_DAYS" },
  systemLogs: { label: "Operational logs", unit: "entries", action: "deleted", env: "SYSTEM_LOG_RETENTION_DAYS" },
  sessionSnapshots: {
    label: "Session restore points",
    unit: "snapshots",
    action: "expired (the record of what changed is kept)",
    env: "ADMIN_SESSION_SNAPSHOT_RETENTION_DAYS",
  },
  inactiveUsers: {
    label: "Inactive accounts",
    unit: "accounts",
    action: "deleted, with workspaces they alone own",
    env: "INACTIVE_USER_RETENTION_DAYS",
  },
};

type Worker = { key: string; updatedAt: string; alive: boolean; value: { workerId?: string; pid?: number; memoryMb?: number } };

export async function SystemTab({ adminEmail }: { adminEmail: string }) {
  const [tableSizes, [totals], sentry, retention, workers, maintenance] = await Promise.all([
    db.execute<{ tableName: string; totalBytes: number; dataBytes: number; indexBytes: number; rows: number }>(sql`
      select
        relname as "tableName",
        pg_total_relation_size(relid)::bigint as "totalBytes",
        pg_relation_size(relid)::bigint as "dataBytes",
        pg_indexes_size(relid)::bigint as "indexBytes",
        n_live_tup::bigint as rows
      from pg_catalog.pg_stat_user_tables
      order by pg_total_relation_size(relid) desc
      limit 20
    `),
    db.execute<{ databaseBytes: number }>(sql`
      select pg_database_size(current_database())::bigint as "databaseBytes"
    `),
    loadSentryIssues(),
    loadRetention(),
    // One row per worker process, written by its heartbeat. The shared
    // "worker" key answers "is anything running"; these answer "how many, and
    // how much memory each is holding", which is the first scaling question.
    db.execute<Worker>(sql`
      select key, updated_at as "updatedAt", value,
        updated_at > now() - interval '60 seconds' as alive
      from system_state
      where key like 'worker:%' and updated_at > now() - interval '1 day'
      order by updated_at desc
    `),
    getMaintenanceState(),
  ]);
  const largest = Math.max(1, ...tableSizes.map((table) => Number(table.totalBytes)));
  const mailer = {
    configured: mailerConfigured(),
    provider: process.env.SUPPORT_EMAIL_PROVIDER?.trim().toLowerCase() || null,
    from: process.env.SUPPORT_EMAIL_FROM?.trim() || null,
  };
  const missing = [
    mailer.provider ? null : "SUPPORT_EMAIL_PROVIDER (smtp or resend)",
    mailer.from ? null : "SUPPORT_EMAIL_FROM",
    mailer.provider === "smtp" && !process.env.SMTP_URL?.trim() ? "SMTP_URL" : null,
    mailer.provider === "resend" && !process.env.RESEND_API_KEY?.trim() ? "RESEND_API_KEY" : null,
  ].filter(Boolean);
  const lastRunValue = retention.lastRun?.value ?? {};
  const scanHours = Math.max(1, Number(process.env.RETENTION_SCAN_INTERVAL_HOURS ?? 24) || 24);
  const cadence = `The worker applies these every ${scanHours} hours (RETENTION_SCAN_INTERVAL_HOURS).`;

  return (
    <>
      <section className="app-card admin-panel">
        <div className="admin-panel-body">
          <AdminMaintenanceToggle {...maintenance} />
        </div>
      </section>

      <div className="admin-two-column">
        <AdminPanel
          action={
            <span className={`admin-sentry-state ${mailer.configured ? "connected" : ""}`}>
              {mailer.configured ? "Configured" : "Not configured"}
            </span>
          }
          description="Ticket notifications and access requests go out through this."
          title="Outbound e-mail"
        >
          <dl className="admin-facts">
            <div><dt>Provider</dt><dd>{mailer.provider ?? "None"}</dd></div>
            <div><dt>Sends as</dt><dd>{mailer.from ?? "Not set"}</dd></div>
          </dl>
          {missing.length ? (
            <div className="admin-sentry-message">
              <Mail size={16} />
              <span>Missing: {missing.join(", ")}. Without these, notifications are skipped and logged, never sent.</span>
            </div>
          ) : null}
          <AdminEmailTest configured={mailer.configured} email={adminEmail} />
        </AdminPanel>

        <AdminPanel
          description="Worker processes that reported in the last day. More than one is fine; each loads its own embedding model."
          icon={Cpu}
          title="Workers"
        >
          <div className="admin-list">
            {[...workers].map((worker) => {
              const alive = worker.alive;
              return (
                <div key={worker.key}>
                  <span className={`admin-job-dot ${alive ? "succeeded" : "failed"}`} />
                  <span>
                    <b>{worker.value.workerId ?? worker.key.replace("worker:", "")}</b>
                    <small>
                      pid {worker.value.pid ?? "?"} · {worker.value.memoryMb ?? "?"} MB resident ·{" "}
                      {alive ? "alive" : "stopped"}
                    </small>
                  </span>
                  <span className="admin-list-meta"><When value={worker.updatedAt} /></span>
                </div>
              );
            })}
          </div>
          {workers.length ? null : <p className="admin-empty">No worker has reported in the last day.</p>}
        </AdminPanel>
      </div>

      <AdminPanel
        description={
          retention.lastRun
            ? `${cadence} Last run ${formatDate(retention.lastRun.updatedAt)}${
                typeof lastRunValue.prunedSnapshots === "number" ? `, which expired ${lastRunValue.prunedSnapshots} restore points` : ""
              }. Run it by hand from Overview.`
            : `${cadence} It has not run yet.`
        }
        icon={Archive}
        title="Retention"
      >
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Record</th>
                <th>Kept for</th>
                <th>Now held</th>
                <th>Due at next run</th>
                <th>Oldest</th>
                <th>Set by</th>
              </tr>
            </thead>
            <tbody>
              {retention.rows.map((row) => {
                const meta = RETENTION_LABELS[row.kind];
                return (
                  <tr key={row.kind}>
                    <td>
                      <b>{meta.label}</b>
                      <small className="admin-muted admin-block">{row.due ? `${row.due.toLocaleString()} will be ${meta.action}` : "Nothing due"}</small>
                    </td>
                    <td>{retention.policy[row.kind]} days</td>
                    <td>
                      {row.total.toLocaleString()} {meta.unit}
                      {row.bytes ? <small className="admin-muted admin-block">{formatBytes(Number(row.bytes))}</small> : null}
                    </td>
                    <td className={row.due ? "admin-warn-text" : undefined}>{row.due.toLocaleString()}</td>
                    <td>{row.oldest ? <When value={row.oldest} /> : "-"}</td>
                    <td><code>{meta.env}</code></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      <section className="app-card admin-table-card">
        <div className="app-card-head">
          <div>
            <h2>PostgreSQL storage</h2>
            <p>
              {formatBytes(Number(totals.databaseBytes))} in total. Table, TOAST and index usage inside the Docker volume.
            </p>
          </div>
          <HardDrive size={18} />
        </div>
        <div className="admin-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Table</th>
                <th>Rows (approx.)</th>
                <th>Data</th>
                <th>Indexes</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {tableSizes.map((table) => (
                <tr key={table.tableName}>
                  <td>
                    <code>{table.tableName}</code>
                    <span className="admin-size-bar">
                      <i style={{ width: `${(Number(table.totalBytes) / largest) * 100}%` }} />
                    </span>
                  </td>
                  <td>{Number(table.rows).toLocaleString()}</td>
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

      <ReleasePanel reportedVersion={APP_VERSION} />

      <AdminPanel
        action={
          <span className={`admin-sentry-state ${sentry.connected ? "connected" : ""}`}>
            {sentry.connected ? "Connected" : sentry.configured ? "DSN active" : "Not configured"}
          </span>
        }
        description="Unhandled application errors from the configured Sentry project."
        title="Sentry issues"
      >
        {sentry.message ? (
          <div className="admin-sentry-message">
            <CircleAlert size={16} />
            <span>{sentry.message}</span>
          </div>
        ) : null}
        {sentry.issues.length ? (
          <div className="admin-log-list">
            {sentry.issues.map((issue) => (
              <Link href={issue.permalink} key={issue.id} target="_blank">
                <span className={`log-level-${issue.level}`}>{issue.shortId}</span>
                <b>{issue.title}</b>
                <small>
                  {issue.count} events · last seen {formatDate(issue.lastSeen)} <ExternalLink size={11} />
                </small>
              </Link>
            ))}
          </div>
        ) : sentry.connected ? (
          <p className="admin-empty">No open issues.</p>
        ) : null}
      </AdminPanel>
    </>
  );
}
