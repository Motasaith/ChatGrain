import { and, desc, eq, gt, ilike, or, sql } from "drizzle-orm";
import { Clock3, History, ScrollText } from "lucide-react";
import { AdminJobActions } from "@/components/app/admin-job-actions";
import { AdminSessionActions } from "@/components/app/admin-session-actions";
import { db } from "@/lib/db/client";
import { adminSessions, agents, auditLogs, crawlJobs, sources, systemLogs, workspaces } from "@/lib/db/schema";
import {
  type AdminSearchParams,
  JOB_PILL,
  PAGE_SIZE,
  SESSION_PILL,
  formatDate,
  likePattern,
  readPage,
  readParam,
} from "./shared";
import { AdminPanel, Empty, FilterChips, Pager, SearchForm, Toolbar, When } from "./ui";

const JOB_STATES = [
  "queued",
  "running",
  "awaiting_review",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
] as const;

export async function JobsTab({ params }: { params: AdminSearchParams }) {
  const query = readParam(params, "q");
  const status = readParam(params, "status");
  const page = readPage(params);
  const filters = { q: query, status };
  const statusFilter = JOB_STATES.find((value) => value === status);

  // Joined rather than selected bare. A row that says only "running" and a job
  // id is not something anyone can act on, so it has to say whose crawl it is,
  // and a failure has to carry the message that explains it.
  const [rows, statusCounts] = await Promise.all([
    db
      .select({
        id: crawlJobs.id,
        status: crawlJobs.status,
        phase: crawlJobs.phase,
        progress: crawlJobs.progress,
        pagesProcessed: crawlJobs.pagesProcessed,
        pagesDiscovered: crawlJobs.pagesDiscovered,
        attempt: crawlJobs.attempt,
        maxAttempts: crawlJobs.maxAttempts,
        errorCode: crawlJobs.errorCode,
        errorMessage: crawlJobs.errorMessage,
        updatedAt: crawlJobs.updatedAt,
        sourceName: sources.name,
        rootUrl: sources.rootUrl,
        agentName: agents.name,
        workspaceName: workspaces.name,
      })
      .from(crawlJobs)
      .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
      .innerJoin(agents, eq(agents.id, sources.agentId))
      .innerJoin(workspaces, eq(workspaces.id, agents.workspaceId))
      .where(
        and(
          statusFilter ? eq(crawlJobs.status, statusFilter) : undefined,
          query
            ? or(
                ilike(sources.name, likePattern(query)),
                ilike(sources.rootUrl, likePattern(query)),
                ilike(agents.name, likePattern(query)),
                ilike(workspaces.name, likePattern(query)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(crawlJobs.updatedAt))
      .limit(PAGE_SIZE + 1)
      .offset(page * PAGE_SIZE),
    db
      .select({ status: crawlJobs.status, count: sql<number>`count(*)::int` })
      .from(crawlJobs)
      .groupBy(crawlJobs.status),
  ]);
  const shown = rows.slice(0, PAGE_SIZE);
  const countOf = (value: string) => statusCounts.find((row) => row.status === value)?.count ?? 0;

  return (
    <AdminPanel description="Crawl and indexing work across every workspace, most recent first." icon={Clock3} title="Crawl jobs">
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
                  <small>{job.workspaceName}{job.rootUrl ? ` · ${job.rootUrl}` : ""}</small>
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
const SESSION_STATES = ["open", "kept", "discarded", "reverted"] as const;

export async function SessionsTab({ params }: { params: AdminSearchParams }) {
  const status = readParam(params, "status");
  const query = readParam(params, "q");
  const page = readPage(params);
  const filters = { q: query, status };
  const statusFilter = SESSION_STATES.find((value) => value === status);

  const [rows, statusCounts] = await Promise.all([
    db
      .select({
        id: adminSessions.id,
        adminEmail: adminSessions.adminEmail,
        status: adminSessions.status,
        reason: adminSessions.reason,
        startedAt: adminSessions.startedAt,
        endedAt: adminSessions.endedAt,
        summary: adminSessions.summary,
        workspaceName: workspaces.name,
      })
      .from(adminSessions)
      .innerJoin(workspaces, eq(workspaces.id, adminSessions.workspaceId))
      .where(
        and(
          statusFilter ? eq(adminSessions.status, statusFilter) : undefined,
          query
            ? or(ilike(workspaces.name, likePattern(query)), ilike(adminSessions.adminEmail, likePattern(query)))
            : undefined,
        ),
      )
      .orderBy(desc(adminSessions.startedAt))
      .limit(PAGE_SIZE + 1)
      .offset(page * PAGE_SIZE),
    db
      .select({ status: adminSessions.status, count: sql<number>`count(*)::int` })
      .from(adminSessions)
      .groupBy(adminSessions.status),
  ]);
  const shown = rows.slice(0, PAGE_SIZE);
  const countOf = (value: string) => statusCounts.find((row) => row.status === value)?.count ?? 0;

  return (
    <AdminPanel
      description="Every session where an administrator could change something. The configuration was copied on the way in, so any of these can still be put back."
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
            {shown.map((session) => {
              const changes = (session.summary as { changes?: SessionChange[] } | null)?.changes ?? [];
              return (
                <tr key={session.id}>
                  <td><b>{session.workspaceName}</b></td>
                  <td>{session.adminEmail}</td>
                  <td className="admin-clip" title={session.reason ?? undefined}>{session.reason ?? "-"}</td>
                  <td><When value={session.startedAt} /></td>
                  <td>{session.status === "open" ? "-" : changes.length.toLocaleString()}</td>
                  <td>
                    <i className={`status-pill status-${SESSION_PILL[session.status] ?? "queued"}`}>{session.status}</i>
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
      {shown.length ? null : (
        <Empty>{query || status ? "No sessions match." : "No administrator has edited a workspace yet."}</Empty>
      )}
      <Pager filters={filters} hasMore={rows.length > PAGE_SIZE} page={page} shown={shown.length} tab="sessions" />
    </AdminPanel>
  );
}

export async function AuditTab({ params }: { params: AdminSearchParams }) {
  const query = readParam(params, "q");
  const area = readParam(params, "area");
  const page = readPage(params);
  const filters = { q: query, area };
  const areaExpression = sql<string>`split_part(${auditLogs.action}, '.', 1)`;

  // The filter options come from the data, so a new kind of event shows up
  // here the day it is first recorded instead of when someone edits a list.
  const [rows, areas] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(
        and(
          area ? eq(areaExpression, area) : undefined,
          query
            ? or(
                ilike(auditLogs.message, likePattern(query)),
                ilike(auditLogs.actorEmail, likePattern(query)),
                ilike(auditLogs.action, likePattern(query)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(PAGE_SIZE + 1)
      .offset(page * PAGE_SIZE),
    db
      .select({ area: areaExpression, count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .groupBy(areaExpression)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ]);
  const shown = rows.slice(0, PAGE_SIZE);

  return (
    <AdminPanel description="Who changed what, across every workspace." icon={ScrollText} title="Audit trail">
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
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>What</th>
              <th>By</th>
              <th>Target</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((entry) => (
              <tr key={entry.id}>
                <td><When value={entry.createdAt} /></td>
                <td className="admin-job-cell">
                  <b>{entry.message}</b>
                  <code>{entry.action}</code>
                </td>
                <td>{entry.actorEmail ?? "System"}</td>
                <td className="admin-muted">{entry.targetType ? `${entry.targetType} ${entry.targetId ?? ""}` : "-"}</td>
                <td className="admin-muted"><code>{entry.ipAddress ?? ""}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length ? null : (
        <Empty>{query || area ? "No events match." : "Audit events will appear after application changes."}</Empty>
      )}
      <Pager filters={filters} hasMore={rows.length > PAGE_SIZE} page={page} shown={shown.length} tab="audit" />
    </AdminPanel>
  );
}

const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;

export async function LogsTab({ params }: { params: AdminSearchParams }) {
  const query = readParam(params, "q");
  const level = readParam(params, "level");
  const page = readPage(params);
  const filters = { q: query, level };

  const [rows, dayCounts] = await Promise.all([
    db
      .select()
      .from(systemLogs)
      .where(
        and(
          level ? eq(systemLogs.level, level) : undefined,
          query
            ? or(ilike(systemLogs.message, likePattern(query)), ilike(systemLogs.service, likePattern(query)))
            : undefined,
        ),
      )
      .orderBy(desc(systemLogs.createdAt))
      .limit(PAGE_SIZE * 2 + 1)
      .offset(page * PAGE_SIZE * 2),
    db
      .select({ level: systemLogs.level, count: sql<number>`count(*)::int` })
      .from(systemLogs)
      .where(gt(systemLogs.createdAt, sql`now() - interval '1 day'`))
      .groupBy(systemLogs.level),
  ]);
  const pageSize = PAGE_SIZE * 2;
  const shown = rows.slice(0, pageSize);
  const countOf = (value: string) => dayCounts.find((row) => row.level === value)?.count ?? 0;

  return (
    <AdminPanel
      action={
        <span className="admin-log-summary">
          Last 24h: <b className="log-level-error">{countOf("error")} errors</b> ·{" "}
          <b className="log-level-warn">{countOf("warn")} warnings</b> · {countOf("info")} info
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
      <Pager filters={filters} hasMore={rows.length > pageSize} page={page} shown={shown.length} tab="logs" />
    </AdminPanel>
  );
}

