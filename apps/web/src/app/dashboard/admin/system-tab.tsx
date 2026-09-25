import Link from "next/link";
import { sql } from "drizzle-orm";
import { CircleAlert, ExternalLink, HardDrive } from "lucide-react";
import { ReleasePanel } from "@/components/app/release-panel";
import { db } from "@/lib/db/client";
import { APP_VERSION } from "@/lib/version";
import { formatBytes, formatDate, loadSentryIssues } from "./shared";
import { AdminPanel } from "./ui";

export async function SystemTab() {
  const [tableSizes, [totals], sentry] = await Promise.all([
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
  ]);
  const largest = Math.max(1, ...tableSizes.map((table) => Number(table.totalBytes)));

  return (
    <>
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
