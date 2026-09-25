import Link from "next/link";
import { and, desc, eq, ilike, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { Bot, ShieldCheck, Users } from "lucide-react";
import { AdminAgentActions } from "@/components/app/admin-agent-actions";
import { AdminUserActions } from "@/components/app/admin-user-actions";
import { AdminWorkspaceActions } from "@/components/app/admin-workspace-actions";
import { ImpersonateButton } from "@/components/app/impersonate-button";
import { getAdminEmails } from "@/lib/auth/admin-emails";
import { db } from "@/lib/db/client";
import { agents, conversations, memberships, sources, users, workspaceUsage, workspaces } from "@/lib/db/schema";
import {
  type AdminSearchParams,
  PAGE_SIZE,
  likePattern,
  readPage,
  readParam,
} from "./shared";
import { AdminPanel, Empty, FilterChips, Pager, SearchForm, Toolbar, When } from "./ui";

// Thirty days, because "which workspace is expensive" is a question about a
// trend and a single day answers it badly.
const answersLast30 = sql<number>`(
  select coalesce(sum(calls), 0)::int from ${workspaceUsage}
  where ${workspaceUsage.workspaceId} = ${workspaces.id}
    and ${workspaceUsage.kind} = 'generation'
    and ${workspaceUsage.day} >= to_char(now() - interval '30 days', 'YYYY-MM-DD')
)`;

export async function WorkspacesTab({ params }: { params: AdminSearchParams }) {
  const query = readParam(params, "q");
  const state = readParam(params, "state");
  const sort = readParam(params, "sort");
  const page = readPage(params);
  const filters = { q: query, state, sort };

  const where = and(
    query ? ilike(workspaces.name, likePattern(query)) : undefined,
    state === "suspended" ? isNotNull(workspaces.suspendedAt) : undefined,
    state === "active" ? isNull(workspaces.suspendedAt) : undefined,
  );

  const [rows, [counts]] = await Promise.all([
    db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        plan: workspaces.plan,
        suspendedAt: workspaces.suspendedAt,
        suspendedReason: workspaces.suspendedReason,
        pageLimit: workspaces.pageLimit,
        minRefreshHours: workspaces.minRefreshHours,
        createdAt: workspaces.createdAt,
        memberCount: sql<number>`(
          select count(*)::int from ${memberships} where ${memberships.workspaceId} = ${workspaces.id}
        )`,
        agentCount: sql<number>`(
          select count(*)::int from ${agents} where ${agents.workspaceId} = ${workspaces.id}
        )`,
        answersLast30,
        passagesLast30: sql<number>`(
          select coalesce(sum(units), 0)::int from ${workspaceUsage}
          where ${workspaceUsage.workspaceId} = ${workspaces.id}
            and ${workspaceUsage.kind} = 'embedding'
            and ${workspaceUsage.day} >= to_char(now() - interval '30 days', 'YYYY-MM-DD')
        )`,
      })
      .from(workspaces)
      .where(where)
      .orderBy(sort === "usage" ? desc(answersLast30) : desc(workspaces.createdAt))
      .limit(PAGE_SIZE + 1)
      .offset(page * PAGE_SIZE),
    db
      .select({
        all: sql<number>`count(*)::int`,
        suspended: sql<number>`count(*) filter (where ${workspaces.suspendedAt} is not null)::int`,
      })
      .from(workspaces),
  ]);
  const shown = rows.slice(0, PAGE_SIZE);

  return (
    <AdminPanel description="Every account here, and what it is allowed to do." icon={ShieldCheck} title="Workspaces">
      <Toolbar>
        <SearchForm filters={{ state, sort }} placeholder="Search workspaces" query={query} tab="workspaces" />
        <FilterChips
          current={state}
          filters={filters}
          name="state"
          options={[
            { value: "", label: "All", count: counts.all },
            { value: "active", label: "Active", count: counts.all - counts.suspended },
            { value: "suspended", label: "Suspended", count: counts.suspended },
          ]}
          tab="workspaces"
        />
        <FilterChips
          current={sort}
          filters={filters}
          name="sort"
          options={[
            { value: "", label: "Newest" },
            { value: "usage", label: "Most answers" },
          ]}
          tab="workspaces"
        />
      </Toolbar>
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Plan</th>
              <th>Members</th>
              <th>Agents</th>
              <th title="Answers generated in the last 30 days">Answers (30d)</th>
              <th title="Passages embedded in the last 30 days">Passages (30d)</th>
              <th>State</th>
              <th>Created</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((workspace) => (
              <tr key={workspace.id}>
                <td><b>{workspace.name}</b></td>
                <td><span className="admin-plan">{workspace.plan}</span></td>
                <td>{workspace.memberCount}</td>
                <td>{workspace.agentCount}</td>
                <td>{workspace.answersLast30.toLocaleString()}</td>
                <td>{workspace.passagesLast30.toLocaleString()}</td>
                <td>
                  {workspace.suspendedAt ? (
                    <i className="status-pill status-error" title={workspace.suspendedReason ?? undefined}>
                      suspended
                    </i>
                  ) : (
                    <i className="status-pill status-ready">active</i>
                  )}
                </td>
                <td><When value={workspace.createdAt} /></td>
                <td>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length ? null : <Empty>{query || state ? "No workspaces match." : "No workspaces yet."}</Empty>}
      <Pager filters={filters} hasMore={rows.length > PAGE_SIZE} page={page} shown={shown.length} tab="workspaces" />
    </AdminPanel>
  );
}

const AGENT_STATES = ["ready", "training", "draft", "paused", "error"] as const;

export async function AgentsTab({ params }: { params: AdminSearchParams }) {
  const query = readParam(params, "q");
  const status = readParam(params, "status");
  const page = readPage(params);
  const filters = { q: query, status };
  const statusFilter = AGENT_STATES.find((value) => value === status);

  const [rows, statusCounts] = await Promise.all([
    db
      .select({
        id: agents.id,
        name: agents.name,
        status: agents.status,
        createdAt: agents.createdAt,
        workspaceName: workspaces.name,
        workspaceId: workspaces.id,
        sourceCount: sql<number>`(
          select count(*)::int from ${sources} where ${sources.agentId} = ${agents.id}
        )`,
        conversationCount: sql<number>`(
          select count(*)::int from ${conversations}
          where ${conversations.agentId} = ${agents.id}
        )`,
      })
      .from(agents)
      .innerJoin(workspaces, eq(workspaces.id, agents.workspaceId))
      .where(
        and(
          query
            ? or(ilike(agents.name, likePattern(query)), ilike(workspaces.name, likePattern(query)))
            : undefined,
          statusFilter ? eq(agents.status, statusFilter) : undefined,
        ),
      )
      .orderBy(desc(agents.createdAt))
      .limit(PAGE_SIZE + 1)
      .offset(page * PAGE_SIZE),
    db
      .select({ status: agents.status, count: sql<number>`count(*)::int` })
      .from(agents)
      .groupBy(agents.status),
  ]);
  const shown = rows.slice(0, PAGE_SIZE);
  const countOf = (value: string) => statusCounts.find((row) => row.status === value)?.count ?? 0;

  return (
    <AdminPanel description="Every agent on this installation, newest first." icon={Bot} title="Agents">
      <Toolbar>
        <SearchForm filters={{ status }} placeholder="Agent or workspace" query={query} tab="agents" />
        <FilterChips
          current={status}
          filters={filters}
          name="status"
          options={[
            { value: "", label: "All", count: statusCounts.reduce((sum, row) => sum + row.count, 0) },
            ...AGENT_STATES.map((value) => ({ value, label: value, count: countOf(value) })),
          ]}
          tab="agents"
        />
      </Toolbar>
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Workspace</th>
              <th>Status</th>
              <th>Sources</th>
              <th>Chats</th>
              <th>Created</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((agent) => (
              <tr key={agent.id}>
                <td>
                  <Link href={`/dashboard/agents/${agent.id}`}>{agent.name}</Link>
                </td>
                <td>{agent.workspaceName}</td>
                <td><i className={`status-pill status-${agent.status}`}>{agent.status}</i></td>
                <td>{agent.sourceCount}</td>
                <td>{agent.conversationCount.toLocaleString()}</td>
                <td><When value={agent.createdAt} /></td>
                <td>
                  <span className="admin-row-actions">
                    <AdminAgentActions agentId={agent.id} agentName={agent.name} status={agent.status} />
                    <ImpersonateButton workspaceId={agent.workspaceId} workspaceName={agent.workspaceName} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length ? null : <Empty>{query || status ? "No agents match." : "No agents have been created yet."}</Empty>}
      <Pager filters={filters} hasMore={rows.length > PAGE_SIZE} page={page} shown={shown.length} tab="agents" />
    </AdminPanel>
  );
}

export async function PeopleTab({
  params,
  canChangeRoles,
}: {
  params: AdminSearchParams;
  canChangeRoles: boolean;
}) {
  const query = readParam(params, "q");
  const role = readParam(params, "role");
  const page = readPage(params);
  const filters = { q: query, role };
  // Read once here rather than per row: it is the same set for every user, and
  // it decides which role controls are offered as usable.
  const envAdmins = getAdminEmails();
  const retentionDays = Number(process.env.INACTIVE_USER_RETENTION_DAYS ?? 30) || 30;
  const inactive = lt(users.lastSeenAt, sql`now() - make_interval(days => ${retentionDays})`);

  const roleFilter: SQL | undefined =
    role === "admins"
      ? ne(users.platformRole, "member")
      : role === "exempt"
        ? eq(users.retentionExempt, true)
        : role === "inactive"
          ? and(inactive, eq(users.retentionExempt, false))
          : undefined;

  const [rows, [counts]] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        lastSeenAt: users.lastSeenAt,
        retentionExempt: users.retentionExempt,
        platformRole: users.platformRole,
        createdAt: users.createdAt,
        workspaceNames: sql<string[]>`coalesce((
          select array_agg(w.name order by m.created_at)
          from ${memberships} m join ${workspaces} w on w.id = m.workspace_id
          where m.user_id = ${users.id}
        ), '{}')`,
      })
      .from(users)
      .where(
        and(
          query ? or(ilike(users.email, likePattern(query)), ilike(users.name, likePattern(query))) : undefined,
          roleFilter,
        ),
      )
      // Administrators first, then by recency. On an installation with many
      // customers the handful of people who can operate it are the rows this
      // view exists for, and they should not sink under everyone else.
      .orderBy(sql`case when ${users.platformRole} = 'member' then 1 else 0 end`, desc(users.lastSeenAt))
      .limit(PAGE_SIZE + 1)
      .offset(page * PAGE_SIZE),
    db
      .select({
        all: sql<number>`count(*)::int`,
        admins: sql<number>`count(*) filter (where ${users.platformRole} <> 'member')::int`,
        exempt: sql<number>`count(*) filter (where ${users.retentionExempt})::int`,
        inactive: sql<number>`count(*) filter (where ${inactive} and not ${users.retentionExempt})::int`,
      })
      .from(users),
  ]);
  const shown = rows.slice(0, PAGE_SIZE);

  return (
    <AdminPanel
      description={`Everyone with an account. Inactive means not seen for ${retentionDays} days, which the retention policy acts on.`}
      icon={Users}
      title="People"
    >
      <Toolbar>
        <SearchForm filters={{ role }} placeholder="Name or email" query={query} tab="people" />
        <FilterChips
          current={role}
          filters={filters}
          name="role"
          options={[
            { value: "", label: "Everyone", count: counts.all },
            { value: "admins", label: "Platform staff", count: counts.admins },
            { value: "exempt", label: "Retention exempt", count: counts.exempt },
            { value: "inactive", label: "Inactive", count: counts.inactive },
          ]}
          tab="people"
        />
      </Toolbar>
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Workspaces</th>
              <th>Role</th>
              <th>Last seen</th>
              <th>Joined</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((user) => (
              <tr key={user.id}>
                <td>
                  <span className="admin-person">
                    {user.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" referrerPolicy="no-referrer" src={user.avatarUrl} />
                    ) : (
                      <span className="admin-list-icon">{user.name.slice(0, 1).toUpperCase()}</span>
                    )}
                    <span>
                      <b>{user.name}</b>
                      <small>{user.email}</small>
                    </span>
                  </span>
                </td>
                <td title={user.workspaceNames.join(", ")}>
                  {user.workspaceNames.length
                    ? `${user.workspaceNames[0]}${user.workspaceNames.length > 1 ? ` +${user.workspaceNames.length - 1}` : ""}`
                    : "None"}
                </td>
                <td>
                  <i className={`status-pill ${user.platformRole === "member" ? "" : "status-review"}`}>
                    {user.platformRole}
                  </i>
                </td>
                <td>{user.retentionExempt ? "Exempt" : <When value={user.lastSeenAt} />}</td>
                <td><When value={user.createdAt} /></td>
                <td>
                  <AdminUserActions
                    canChangeRoles={canChangeRoles}
                    email={user.email}
                    fixedByEnvironment={envAdmins.has(user.email.toLowerCase())}
                    platformRole={user.platformRole}
                    retentionExempt={user.retentionExempt}
                    userId={user.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length ? null : <Empty>{query || role ? "Nobody matches." : "No users yet."}</Empty>}
      <Pager filters={filters} hasMore={rows.length > PAGE_SIZE} page={page} shown={shown.length} tab="people" />
    </AdminPanel>
  );
}
