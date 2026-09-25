import Link from "next/link";
import { sql } from "drizzle-orm";
import { Bot, ShieldCheck, Users } from "lucide-react";
import { AdminAgentActions } from "@/components/app/admin-agent-actions";
import { AdminUserActions } from "@/components/app/admin-user-actions";
import { AdminWorkspaceActions } from "@/components/app/admin-workspace-actions";
import { ImpersonateButton } from "@/components/app/impersonate-button";
import { getAdminEmails } from "@/lib/auth/admin-emails";
import { db } from "@/lib/db/client";
import { agents, users, workspaces } from "@/lib/db/schema";
import {
  type AdminSearchParams,
  PAGE_SIZE,
  adminHref,
  readPage,
  readParam,
  retentionDays,
} from "./shared";
import { AGENT_STATES, agentRows, inactiveCondition, personRows, workspaceRows } from "./queries";
import { AdminPanel, Empty, ExportLink, FilterChips, Pager, SearchForm, Toolbar, When } from "./ui";

export async function WorkspacesTab({ params }: { params: AdminSearchParams }) {
  const query = readParam(params, "q");
  const state = readParam(params, "state");
  const sort = readParam(params, "sort");
  const page = readPage(params);
  const filters = { q: query, state, sort };

  const [rows, [counts]] = await Promise.all([
    workspaceRows(params, PAGE_SIZE + 1, page * PAGE_SIZE),
    db
      .select({
        all: sql<number>`count(*)::int`,
        suspended: sql<number>`count(*) filter (where ${workspaces.suspendedAt} is not null)::int`,
      })
      .from(workspaces),
  ]);
  const shown = rows.slice(0, PAGE_SIZE);

  return (
    <AdminPanel
      action={<ExportLink filters={filters} tab="workspaces" />}
      description="Every account here, and what it is allowed to do. Open one for its members, usage and history."
      icon={ShieldCheck}
      title="Workspaces"
    >
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
                <td>
                  <Link href={adminHref("workspace", { id: workspace.id })}>{workspace.name}</Link>
                </td>
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

export async function AgentsTab({ params }: { params: AdminSearchParams }) {
  const query = readParam(params, "q");
  const status = readParam(params, "status");
  const page = readPage(params);
  const filters = { q: query, status };

  const [rows, statusCounts] = await Promise.all([
    agentRows(params, PAGE_SIZE + 1, page * PAGE_SIZE),
    db
      .select({ status: agents.status, count: sql<number>`count(*)::int` })
      .from(agents)
      .groupBy(agents.status),
  ]);
  const shown = rows.slice(0, PAGE_SIZE);
  const countOf = (value: string) => statusCounts.find((row) => row.status === value)?.count ?? 0;

  return (
    <AdminPanel
      action={<ExportLink filters={filters} tab="agents" />}
      description="Every agent on this installation, newest first."
      icon={Bot}
      title="Agents"
    >
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
                <td>
                  <Link className="admin-quiet-link" href={adminHref("workspace", { id: agent.workspaceId })}>
                    {agent.workspaceName}
                  </Link>
                </td>
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
  const inactive = inactiveCondition();

  const [rows, [counts]] = await Promise.all([
    personRows(params, PAGE_SIZE + 1, page * PAGE_SIZE),
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
      action={<ExportLink filters={filters} tab="people" />}
      description={`Everyone with an account. Inactive means not seen for ${retentionDays()} days, which the retention policy acts on.`}
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
                  <Link className="admin-person" href={adminHref("person", { id: user.id })}>
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
                  </Link>
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
