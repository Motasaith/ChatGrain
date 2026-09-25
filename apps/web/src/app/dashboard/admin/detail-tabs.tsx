import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  ArrowLeft,
  Bot,
  Clock3,
  FileText,
  History,
  Inbox,
  MessageSquareText,
  ScrollText,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import { AdminAgentActions } from "@/components/app/admin-agent-actions";
import { AdminDailyBars } from "@/components/app/admin-daily-bars";
import { AdminUserActions } from "@/components/app/admin-user-actions";
import { AdminWorkspaceActions } from "@/components/app/admin-workspace-actions";
import { ImpersonateButton } from "@/components/app/impersonate-button";
import { getAdminEmails } from "@/lib/auth/admin-emails";
import { SANDBOX_CHANNEL } from "@/lib/chat/sandbox";
import { db } from "@/lib/db/client";
import { memberships, users, workspaces } from "@/lib/db/schema";
import { AuditList, SessionTable } from "./activity-tabs";
import { auditRows, groundedRate, jobRows, sessionRows } from "./queries";
import { JOB_PILL, adminHref, formatDate } from "./shared";
import { AdminPanel, Empty, StatTile, When } from "./ui";

const DETAIL_DAYS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Missing({ back, label }: { back: string; label: string }) {
  return (
    <AdminPanel title="Not found">
      <Empty>
        That {label} does not exist, or was deleted. <Link href={adminHref(back)}>Back to the list</Link>
      </Empty>
    </AdminPanel>
  );
}

function BackLink({ tab, label }: { tab: string; label: string }) {
  return (
    <Link className="admin-back" href={adminHref(tab)}>
      <ArrowLeft size={14} /> {label}
    </Link>
  );
}

type WorkspaceNumbers = {
  sources: number;
  documents: number;
  conversations: number;
  escalated: number;
  openTickets: number;
  answers: number;
  grounded: number;
  ungrounded: number;
  thumbsDown: number;
};

type WorkspaceDay = { day: string; answers: number; passages: number; conversations: number };

/**
 * Everything about one workspace on one page.
 *
 * Before this, "what is going on with Acme" meant filtering four tabs by the
 * same name and holding the answers in your head. Every list here is the same
 * query as its tab, narrowed to this workspace, so the two cannot disagree.
 */
export async function WorkspaceDetail({ id, canChangeRoles }: { id: string; canChangeRoles: boolean }) {
  if (!UUID.test(id)) return <Missing back="workspaces" label="workspace" />;
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  if (!workspace) return <Missing back="workspaces" label="workspace" />;

  const scoped = { workspace: id };
  const envAdmins = getAdminEmails();
  const [members, agentList, [numbers], series, jobs, sessions, audit] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        platformRole: users.platformRole,
        retentionExempt: users.retentionExempt,
        lastSeenAt: users.lastSeenAt,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, id))
      .orderBy(desc(users.lastSeenAt)),
    db.execute<{ id: string; name: string; status: string; sources: number; documents: number; conversations: number }>(sql`
      select a.id, a.name, a.status,
        (select count(*)::int from sources s where s.agent_id = a.id) as sources,
        (select count(*)::int from documents d join sources s on s.id = d.source_id where s.agent_id = a.id) as documents,
        (select count(*)::int from conversations c where c.agent_id = a.id and c.channel <> ${SANDBOX_CHANNEL}) as conversations
      from agents a
      where a.workspace_id = ${id}
      order by a.created_at desc
    `),
    db.execute<WorkspaceNumbers>(sql`
      with scoped_agents as (select id from agents where workspace_id = ${id}),
      answered as (
        select m.grounded, f.rating
        from conversations c
        join messages m on m.conversation_id = c.id
        left join feedback f on f.message_id = m.id
        where c.agent_id in (select id from scoped_agents)
          and c.channel <> ${SANDBOX_CHANNEL}
          and c.last_message_at >= now() - make_interval(days => ${DETAIL_DAYS})
          and m.role = 'assistant'
          and m.created_at >= now() - make_interval(days => ${DETAIL_DAYS})
      )
      select
        (select count(*)::int from sources where agent_id in (select id from scoped_agents)) as sources,
        (select count(*)::int from documents d join sources s on s.id = d.source_id
          where s.agent_id in (select id from scoped_agents)) as documents,
        (select count(*)::int from conversations
          where agent_id in (select id from scoped_agents) and channel <> ${SANDBOX_CHANNEL}) as conversations,
        (select count(*)::int from conversations
          where agent_id in (select id from scoped_agents) and channel <> ${SANDBOX_CHANNEL}
            and status = 'escalated') as escalated,
        (select count(*)::int from tickets where workspace_id = ${id} and status in ('open', 'pending')) as "openTickets",
        (select count(*)::int from answered) as answers,
        (select count(*)::int from answered where grounded) as grounded,
        (select count(*)::int from answered where grounded = false) as ungrounded,
        (select count(*)::int from answered where rating < 0) as "thumbsDown"
    `),
    db.execute<WorkspaceDay>(sql`
      with days as (
        select to_char(day, 'YYYY-MM-DD') as day
        from generate_series(
          date_trunc('day', now() at time zone 'utc') - make_interval(days => ${DETAIL_DAYS - 1}),
          date_trunc('day', now() at time zone 'utc'),
          interval '1 day'
        ) as day
      ),
      usage as (
        select day,
          sum(calls) filter (where kind = 'generation')::int as answers,
          sum(units) filter (where kind = 'embedding')::int as passages
        from workspace_usage
        where workspace_id = ${id}
          and day >= to_char(now() at time zone 'utc' - make_interval(days => ${DETAIL_DAYS - 1}), 'YYYY-MM-DD')
        group by day
      ),
      chats as (
        select to_char(c.created_at at time zone 'utc', 'YYYY-MM-DD') as day, count(*)::int as n
        from conversations c join agents a on a.id = c.agent_id
        where a.workspace_id = ${id}
          and c.channel <> ${SANDBOX_CHANNEL}
          and c.created_at >= now() - make_interval(days => ${DETAIL_DAYS})
        group by 1
      )
      select days.day,
        coalesce(usage.answers, 0) as answers,
        coalesce(usage.passages, 0) as passages,
        coalesce(chats.n, 0) as conversations
      from days
      left join usage using (day)
      left join chats using (day)
      order by days.day
    `),
    jobRows(scoped, 8),
    sessionRows(scoped, 8),
    auditRows(scoped, 15),
  ]);
  const rate = groundedRate(numbers);

  return (
    <>
      <BackLink label="All workspaces" tab="workspaces" />
      <section className="app-card admin-detail-head">
        <div>
          <span className="page-eyebrow">Workspace · {workspace.plan}</span>
          <h2>{workspace.name}</h2>
          <p>
            Created {formatDate(workspace.createdAt)} · page limit {workspace.pageLimit ?? "default"} · re-crawl floor{" "}
            {workspace.minRefreshHours ? `${workspace.minRefreshHours} h` : "default"}
          </p>
          {workspace.suspendedAt ? (
            <p className="admin-detail-warning">
              Suspended {formatDate(workspace.suspendedAt)}
              {workspace.suspendedReason ? `: ${workspace.suspendedReason}` : ""}
            </p>
          ) : null}
        </div>
        <span className="admin-row-actions">
          <AdminWorkspaceActions
            minRefreshHours={workspace.minRefreshHours}
            name={workspace.name}
            pageLimit={workspace.pageLimit}
            suspended={Boolean(workspace.suspendedAt)}
            workspaceId={workspace.id}
          />
          <ImpersonateButton workspaceId={workspace.id} workspaceName={workspace.name} />
        </span>
      </section>

      <div className="admin-stats-grid">
        <StatTile hint={`${agentList.length} agents`} icon={Users} label="Members" value={members.length} />
        <StatTile hint={`${numbers.documents.toLocaleString()} documents`} icon={FileText} label="Sources" value={numbers.sources} />
        <StatTile
          hint={`${numbers.escalated} waiting on a person`}
          icon={MessageSquareText}
          label="Conversations"
          tone={numbers.escalated ? "warn" : undefined}
          value={numbers.conversations}
        />
        <StatTile
          href={adminHref("waiting", { kind: "tickets", q: workspace.name })}
          hint="Open or pending"
          icon={Inbox}
          label="Tickets"
          tone={numbers.openTickets ? "warn" : undefined}
          value={numbers.openTickets}
        />
        <StatTile
          hint={`${numbers.answers.toLocaleString()} answers in ${DETAIL_DAYS} days`}
          icon={Target}
          label="Grounded"
          tone={rate !== null && rate < 0.6 ? "bad" : rate !== null && rate < 0.8 ? "warn" : undefined}
          value={rate === null ? "-" : `${Math.round(rate * 100)}%`}
        />
        <StatTile
          hint={`in ${DETAIL_DAYS} days`}
          icon={ShieldCheck}
          label="Thumbs down"
          tone={numbers.thumbsDown ? "warn" : undefined}
          value={numbers.thumbsDown}
        />
      </div>

      <div className="admin-chart-grid">
        {(
          [
            ["answers", "Answers generated", "answers", "purple"],
            ["conversations", "Conversations started", "conversations", "green"],
            ["passages", "Passages embedded", "passages", "blue"],
          ] as const
        ).map(([key, label, unit, tone]) => (
          <section className="app-card admin-panel" key={key}>
            <div className="admin-panel-body">
              <AdminDailyBars
                data={[...series].map((day) => ({ day: day.day, value: day[key] }))}
                label={label}
                tone={tone}
                unit={unit}
              />
            </div>
          </section>
        ))}
      </div>

      <div className="admin-two-column">
        <AdminPanel icon={Users} title="Members">
          <div className="admin-list">
            {members.map((member) => (
              <div key={member.id}>
                <span className="admin-list-icon">{member.name.slice(0, 1).toUpperCase()}</span>
                <span>
                  <b><Link href={adminHref("person", { id: member.id })}>{member.name}</Link></b>
                  <small>{member.email} · {member.role}</small>
                </span>
                <span className="admin-list-meta"><When value={member.lastSeenAt} /></span>
                <AdminUserActions
                  canChangeRoles={canChangeRoles}
                  email={member.email}
                  fixedByEnvironment={envAdmins.has(member.email.toLowerCase())}
                  platformRole={member.platformRole}
                  retentionExempt={member.retentionExempt}
                  userId={member.id}
                />
              </div>
            ))}
          </div>
          {members.length ? null : <Empty>Nobody belongs to this workspace.</Empty>}
        </AdminPanel>

        <AdminPanel icon={Bot} title="Agents">
          <div className="admin-list">
            {[...agentList].map((agent) => (
              <div key={agent.id}>
                <i className={`status-pill status-${agent.status}`}>{agent.status}</i>
                <span>
                  <b><Link href={`/dashboard/agents/${agent.id}`}>{agent.name}</Link></b>
                  <small>
                    {agent.sources} sources · {agent.documents.toLocaleString()} documents · {agent.conversations.toLocaleString()} chats
                  </small>
                </span>
                <AdminAgentActions agentId={agent.id} agentName={agent.name} status={agent.status} />
              </div>
            ))}
          </div>
          {agentList.length ? null : <Empty>No agents yet.</Empty>}
        </AdminPanel>
      </div>

      <AdminPanel
        action={<Link className="admin-panel-link" href={adminHref("jobs", { q: workspace.name })}>All jobs</Link>}
        icon={Clock3}
        title="Recent crawl jobs"
      >
        <div className="admin-list">
          {jobs.map((job) => (
            <div key={job.id}>
              <i className={`status-pill status-${JOB_PILL[job.status] ?? "queued"}`}>{job.status.replace("_", " ")}</i>
              <span>
                <b>{job.agentName} · {job.sourceName}</b>
                <small>
                  {job.pagesProcessed.toLocaleString()} / {job.pagesDiscovered.toLocaleString()} pages
                  {job.status === "failed" && job.errorMessage ? ` · ${job.errorMessage}` : ""}
                </small>
              </span>
              <span className="admin-list-meta"><When value={job.updatedAt} /></span>
            </div>
          ))}
        </div>
        {jobs.length ? null : <Empty>No crawl has run for this workspace.</Empty>}
      </AdminPanel>

      <AdminPanel icon={History} title="Editing sessions">
        <SessionTable rows={sessions} />
        {sessions.length ? null : <Empty>No administrator has edited this workspace.</Empty>}
      </AdminPanel>

      <AdminPanel
        description="Recorded under this workspace, including what administrators did to it."
        icon={ScrollText}
        title="Recent audit events"
      >
        <AuditList rows={audit} />
        {audit.length ? null : <Empty>Nothing has been recorded for this workspace.</Empty>}
      </AdminPanel>
    </>
  );
}

/**
 * One person: where they belong, what they have done as an administrator, and
 * the controls for their role and retention.
 */
export async function PersonDetail({ id, canChangeRoles }: { id: string; canChangeRoles: boolean }) {
  if (!UUID.test(id)) return <Missing back="people" label="person" />;
  const [person] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!person) return <Missing back="people" label="person" />;

  const [belongs, audit, sessions] = await Promise.all([
    db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        plan: workspaces.plan,
        suspendedAt: workspaces.suspendedAt,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(and(eq(memberships.userId, id)))
      .orderBy(desc(memberships.createdAt)),
    auditRows({ actor: person.email }, 20),
    sessionRows({ admin: person.email }, 10),
  ]);
  const fixed = getAdminEmails().has(person.email.toLowerCase());

  return (
    <>
      <BackLink label="All people" tab="people" />
      <section className="app-card admin-detail-head">
        <div>
          <span className="page-eyebrow">
            {person.platformRole}
            {fixed ? " · set by ADMIN_EMAILS" : ""}
          </span>
          <h2>{person.name}</h2>
          <p>
            {person.email} · joined {formatDate(person.createdAt)} · last seen {formatDate(person.lastSeenAt)}
            {person.retentionExempt ? " · exempt from retention" : ""}
          </p>
        </div>
        <AdminUserActions
          canChangeRoles={canChangeRoles}
          email={person.email}
          fixedByEnvironment={fixed}
          platformRole={person.platformRole}
          retentionExempt={person.retentionExempt}
          userId={person.id}
        />
      </section>

      <AdminPanel icon={ShieldCheck} title="Workspaces">
        <div className="admin-list">
          {belongs.map((workspace) => (
            <div key={workspace.id}>
              <span className="admin-list-icon">{workspace.name.slice(0, 1).toUpperCase()}</span>
              <span>
                <b><Link href={adminHref("workspace", { id: workspace.id })}>{workspace.name}</Link></b>
                <small>
                  {workspace.role} · {workspace.plan} plan · joined {formatDate(workspace.joinedAt)}
                </small>
              </span>
              {workspace.suspendedAt ? <i className="status-pill status-error">suspended</i> : null}
            </div>
          ))}
        </div>
        {belongs.length ? null : <Empty>This person belongs to no workspace.</Empty>}
      </AdminPanel>

      <AdminPanel
        description="Only sessions this person ran as an administrator."
        icon={History}
        title="Editing sessions they ran"
      >
        <SessionTable rows={sessions} />
        {sessions.length ? null : <Empty>None.</Empty>}
      </AdminPanel>

      <AdminPanel description="Events where this person was the one acting." icon={ScrollText} title="What they did">
        <AuditList rows={audit} />
        {audit.length ? null : <Empty>Nothing recorded with this person as the actor.</Empty>}
      </AdminPanel>
    </>
  );
}
