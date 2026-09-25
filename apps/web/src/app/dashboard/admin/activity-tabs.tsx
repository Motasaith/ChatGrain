import Link from "next/link";
import { desc, gt, sql } from "drizzle-orm";
import { Clock3, History, ScrollText } from "lucide-react";
import { AdminAutoRefresh } from "@/components/app/admin-auto-refresh";
import { AdminJobActions } from "@/components/app/admin-job-actions";
import { AdminSessionActions } from "@/components/app/admin-session-actions";
import { db } from "@/lib/db/client";
import { adminSessions, auditLogs, crawlJobs, systemLogs } from "@/lib/db/schema";
import {
  type AdminSearchParams,
  JOB_PILL,
  PAGE_SIZE,
  SESSION_PILL,
  adminHref,
  formatDate,
  readPage,
  readParam,
} from "./shared";
import { JOB_STATES, SESSION_STATES, auditArea, auditRows, jobRows, logRows, sessionRows } from "./queries";
import { AdminPanel, Empty, ExportLink, FilterChips, Pager, SearchForm, Toolbar, When } from "./ui";

export async function JobsTab({ params }: { params: AdminSearchParams }) {
  const query = readParam(params, "q");
  const status = readParam(params, "status");
  const page = readPage(params);
  const filters = { q: query, status };

  const [rows, statusCounts] = await Promise.all([
    jobRows(params, PAGE_SIZE + 1, page * PAGE_SIZE),
    db
      .select({ status: crawlJobs.status, count: sql<number>`count(*)::int` })
      .from(crawlJobs)
      .groupBy(crawlJobs.status),
  ]);
  const shown = rows.slice(0, PAGE_SIZE);
  const countOf = (value: string) => statusCounts.find((row) => row.status === value)?.count ?? 0;

  return (
    <AdminPanel
      action={
        <span className="admin-panel-actions">
          <AdminAutoRefresh seconds={15} />
          <ExportLink filters={filters} tab="jobs" />
        </span>
      }
      description="Crawl and indexing work across every workspace, most recent first."
      icon={Clock3}
      title="Crawl jobs"
    >
      <Toolbar>
        <SearchForm filters={{ status }} placeholder="Source, site, agent or workspace" query={query} tab="jobs" />
        <FilterChips
          current={status}
          filters={filters}
          name="status"
          options={[
            { value: "", label: "All", count: statusCounts.reduce((sum, row) => sum + row.count, 0) },
            ...JOB_STATES.map((value) => ({ value, label: value.replace("_", " "), count: countOf(value) })),
          ]}
          tab="jobs"
        />
      </Toolbar>
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Updated</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((job) => (
              <tr key={job.id}>
                <td className="admin-job-cell">
                  <b>{job.agentName} · {job.sourceName}</b>
                  <small>
                    <Link className="admin-quiet-link" href={adminHref("workspace", { id: job.workspaceId })}>
                      {job.workspaceName}
                    </Link>
                    {job.rootUrl ? ` · ${job.rootUrl}` : ""}
                  </small>
                  {job.status === "failed" ? (
                    <p className="admin-job-error">
                      <i>{job.errorCode ?? "ERROR"}</i>
                      {job.errorMessage || "No error message was recorded."}
                      <small>Failed while {job.phase} · attempt {job.attempt} of {job.maxAttempts}</small>
                    </p>
                  ) : null}
                </td>
                <td>
                  <i className={`status-pill status-${JOB_PILL[job.status] ?? "queued"}`}>
                    {job.status.replace("_", " ")}
                  </i>
                </td>
                <td>
                  <span className="admin-progress" title={`${job.progress}%`}>
                    <i style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }} />
                  </span>
                  <small className="admin-muted">
                    {job.pagesProcessed.toLocaleString()} / {job.pagesDiscovered.toLocaleString()} pages
                  </small>
                </td>
                <td><When value={job.updatedAt} /></td>
                <td>
                  <AdminJobActions jobId={job.id} label={`${job.sourceName} (${job.workspaceName})`} status={job.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length ? null : <Empty>{query || status ? "No jobs match." : "No crawl jobs have run yet."}</Empty>}
      <Pager filters={filters} hasMore={rows.length > PAGE_SIZE} page={page} shown={shown.length} tab="jobs" />
    </AdminPanel>
  );
}

type SessionChange = { table: string; label: string; kind: string };

export function SessionTable({
  rows,
}: {
  rows: Awaited<ReturnType<typeof sessionRows>>;
}) {
  return (
    <div className="admin-table-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Workspace</th>
            <th>Administrator</th>
            <th>Reason</th>
            <th>Started</th>
            <th>Changed</th>
            <th>State</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((session) => {
            const changes = (session.summary as { changes?: SessionChange[] } | null)?.changes ?? [];
            return (
              <tr key={session.id}>
                <td>
                  <Link href={adminHref("workspace", { id: session.workspaceId })}>{session.workspaceName}</Link>
                </td>
                <td>{session.adminEmail}</td>
                <td className="admin-clip" title={session.reason ?? undefined}>{session.reason ?? "-"}</td>
                <td><When value={session.startedAt} /></td>
                <td>{session.status === "open" ? "-" : changes.length.toLocaleString()}</td>
                <td>
                  <i
                    className={`status-pill status-${SESSION_PILL[session.status] ?? "queued"}`}
                    title={session.status === "expired" ? "The restore point was pruned. The record of what changed is kept." : undefined}
                  >
                    {session.status}
                  </i>
                </td>
                <td>
                  <AdminSessionActions
                    adminEmail={session.adminEmail}
                    changes={changes}
                    sessionId={session.id}
                    status={session.status}
                    workspaceName={session.workspaceName}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export async function SessionsTab({ params }: { params: AdminSearchParams }) {
  const status = readParam(params, "status");
  const query = readParam(params, "q");
  const page = readPage(params);
  const filters = { q: query, status };

  const [rows, statusCounts] = await Promise.all([
    sessionRows(params, PAGE_SIZE + 1, page * PAGE_SIZE),
    db
      .select({ status: adminSessions.status, count: sql<number>`count(*)::int` })
      .from(adminSessions)
      .groupBy(adminSessions.status),
  ]);
  const shown = rows.slice(0, PAGE_SIZE);
  const countOf = (value: string) => statusCounts.find((row) => row.status === value)?.count ?? 0;

  return (
    <AdminPanel
      action={<ExportLink filters={filters} tab="sessions" />}
      description="Every session where an administrator could change something. The configuration was copied on the way in, so any of these can still be put back until its restore point is pruned."
      icon={History}
      title="Editing sessions"
    >
      <Toolbar>
        <SearchForm filters={{ status }} placeholder="Workspace or administrator" query={query} tab="sessions" />
        <FilterChips
          current={status}
          filters={filters}
          name="status"
          options={[
            { value: "", label: "All", count: statusCounts.reduce((sum, row) => sum + row.count, 0) },
            ...SESSION_STATES.map((value) => ({ value, label: value, count: countOf(value) })),
          ]}
          tab="sessions"
        />
      </Toolbar>
      <SessionTable rows={shown} />
      {shown.length ? null : (
        <Empty>{query || status ? "No sessions match." : "No administrator has edited a workspace yet."}</Empty>
      )}
      <Pager filters={filters} hasMore={rows.length > PAGE_SIZE} page={page} shown={shown.length} tab="sessions" />
    </AdminPanel>
  );
}

/**
 * Audit rows, each opening to show what the one-line message leaves out.
 *
 * The metadata is where the specifics live - the old and new limit, the
 * counts a deletion removed, the reason typed into a dialog - and it was
 * recorded on every row and shown on none.
 */
export function AuditList({ rows }: { rows: Awaited<ReturnType<typeof auditRows>> }) {
  return (
    <div className="admin-audit-list">
      {rows.map((entry) => {
        const metadata = entry.metadata && Object.keys(entry.metadata).length ? entry.metadata : null;
        return (
          <details key={entry.id}>
            <summary>
              <When value={entry.createdAt} />
              <span className="admin-audit-what">
                <b>{entry.message}</b>
                <small>
                  <code>{entry.action}</code> · {entry.actorEmail ?? "System"}
                  {entry.targetType ? ` · ${entry.targetType}` : ""}
                </small>
              </span>
            </summary>
            <dl>
              <div><dt>When</dt><dd>{formatDate(entry.createdAt)}</dd></div>
              <div><dt>By</dt><dd>{entry.actorEmail ?? "System"}</dd></div>
              {entry.targetType ? (
                <div><dt>Target</dt><dd><code>{entry.targetType} {entry.targetId ?? ""}</code></dd></div>
              ) : null}
              {entry.workspaceId ? (
                <div>
                  <dt>Workspace</dt>
                  <dd><Link href={adminHref("workspace", { id: entry.workspaceId })}>Open workspace</Link></dd>
                </div>
              ) : null}
              {entry.ipAddress ? <div><dt>IP</dt><dd><code>{entry.ipAddress}</code></dd></div> : null}
              {entry.requestId ? <div><dt>Request</dt><dd><code>{entry.requestId}</code></dd></div> : null}
            </dl>
            {metadata ? <pre>{JSON.stringify(metadata, null, 2)}</pre> : <p className="admin-muted">No further detail was recorded.</p>}
          </details>
        );
      })}
    </div>
  );
}

export async function AuditTab({ params }: { params: AdminSearchParams }) {
  const query = readParam(params, "q");
  const area = readParam(params, "area");
  const page = readPage(params);
  const filters = { q: query, area };

  // The filter options come from the data, so a new kind of event shows up
  // here the day it is first recorded instead of when someone edits a list.
  const [rows, areas] = await Promise.all([
    auditRows(params, PAGE_SIZE + 1, page * PAGE_SIZE),
    db
      .select({ area: auditArea, count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .groupBy(auditArea)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ]);
  const shown = rows.slice(0, PAGE_SIZE);

  return (
    <AdminPanel
      action={<ExportLink filters={filters} tab="audit" />}
      description="Who changed what, across every workspace. Open a row for its full detail."
      icon={ScrollText}
      title="Audit trail"
    >
      <Toolbar>
        <SearchForm filters={{ area }} placeholder="Message, action or email" query={query} tab="audit" />
        <FilterChips
          current={area}
          filters={filters}
          name="area"
          options={[
            { value: "", label: "Everything", count: areas.reduce((sum, row) => sum + row.count, 0) },
            ...areas.map((row) => ({ value: row.area, label: row.area, count: row.count })),
          ]}
          tab="audit"
        />
      </Toolbar>
      <AuditList rows={shown} />
      {shown.length ? null : (
        <Empty>{query || area ? "No events match." : "Audit events will appear after application changes."}</Empty>
      )}
      <Pager filters={filters} hasMore={rows.length > PAGE_SIZE} page={page} shown={shown.length} tab="audit" />
    </AdminPanel>
  );
}

const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
const LOG_PAGE_SIZE = PAGE_SIZE * 2;

export async function LogsTab({ params }: { params: AdminSearchParams }) {
  const query = readParam(params, "q");
  const level = readParam(params, "level");
  const page = readPage(params);
  const filters = { q: query, level };

  const [rows, dayCounts] = await Promise.all([
    logRows(params, LOG_PAGE_SIZE + 1, page * LOG_PAGE_SIZE),
    db
      .select({ level: systemLogs.level, count: sql<number>`count(*)::int` })
      .from(systemLogs)
      .where(gt(systemLogs.createdAt, sql`now() - interval '1 day'`))
      .groupBy(systemLogs.level),
  ]);
  const shown = rows.slice(0, LOG_PAGE_SIZE);
  const countOf = (value: string) => dayCounts.find((row) => row.level === value)?.count ?? 0;

  return (
    <AdminPanel
      action={
        <span className="admin-panel-actions">
          <span className="admin-log-summary">
            Last 24h: <b className="log-level-error">{countOf("error")} errors</b> ·{" "}
            <b className="log-level-warn">{countOf("warn")} warnings</b> · {countOf("info")} info
          </span>
          <ExportLink filters={filters} tab="logs" />
        </span>
      }
      description="Durable worker and maintenance events. Open a row for its context."
      title="Operational logs"
    >
      <Toolbar>
        <SearchForm filters={{ level }} placeholder="Message or service" query={query} tab="logs" />
        <FilterChips
          current={level}
          filters={filters}
          name="level"
          options={[{ value: "", label: "All" }, ...LOG_LEVELS.map((value) => ({ value, label: value }))]}
          tab="logs"
        />
      </Toolbar>
      <div className="admin-log-stream">
        {shown.map((entry) => (
          <details key={entry.id}>
            <summary>
              <time dateTime={entry.createdAt.toISOString()} title={formatDate(entry.createdAt)}>
                {entry.createdAt.toLocaleString("en", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
              <span className={`log-level-${entry.level}`}>{entry.level}</span>
              <span className="admin-log-service">{entry.service}</span>
              <span className="admin-log-message">{entry.message}</span>
            </summary>
            <pre>{JSON.stringify(entry.context ?? {}, null, 2)}</pre>
          </details>
        ))}
        {shown.length ? null : (
          <p className="admin-empty">{query || level ? "No entries match." : "Worker events will appear here."}</p>
        )}
      </div>
      <Pager filters={filters} hasMore={rows.length > LOG_PAGE_SIZE} page={page} shown={shown.length} tab="logs" />
    </AdminPanel>
  );
}
