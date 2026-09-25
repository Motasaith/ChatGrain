/**
 * The queries behind the admin console, as functions of the URL.
 *
 * Kept apart from the tabs that render them because two things read them: the
 * tab, one page at a time, and the CSV export, up to the export limit. One
 * function per list means an export is always exactly the filtered list on
 * screen, only longer, and the route handler never imports a component.
 */
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { SANDBOX_CHANNEL } from "@/lib/chat/sandbox";
import { db } from "@/lib/db/client";
import {
  adminSessions,
  agents,
  auditLogs,
  conversations,
  crawlJobs,
  memberships,
  sources,
  systemLogs,
  tickets,
  users,
  workspaceUsage,
  workspaces,
} from "@/lib/db/schema";
import { type AdminSearchParams, QUALITY_MIN_ANSWERS, likePattern, readParam, retentionDays } from "./shared";

export { QUALITY_MIN_ANSWERS, groundedRate } from "./shared";

// Thirty days, because "which workspace is expensive" is a question about a
// trend and a single day answers it badly.
const answersLast30 = sql<number>`(
  select coalesce(sum(calls), 0)::int from ${workspaceUsage}
  where ${workspaceUsage.workspaceId} = ${workspaces.id}
    and ${workspaceUsage.kind} = 'generation'
    and ${workspaceUsage.day} >= to_char(now() - interval '30 days', 'YYYY-MM-DD')
)`;

/**
 * The rows behind each list, as functions of the URL.
 *
 * Shared by the tab and by the CSV export, so an export is always exactly the
 * filtered list on screen, only longer.
 */
export function workspaceRows(params: AdminSearchParams, limit: number, offset = 0) {
  const query = readParam(params, "q");
  const state = readParam(params, "state");
  const sort = readParam(params, "sort");
  return db
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
    .where(
      and(
        query ? ilike(workspaces.name, likePattern(query)) : undefined,
        state === "suspended" ? isNotNull(workspaces.suspendedAt) : undefined,
        state === "active" ? isNull(workspaces.suspendedAt) : undefined,
      ),
    )
    .orderBy(sort === "usage" ? desc(answersLast30) : desc(workspaces.createdAt))
    .limit(limit)
    .offset(offset);
}

export const AGENT_STATES = ["ready", "training", "draft", "paused", "error"] as const;

export function agentRows(params: AdminSearchParams, limit: number, offset = 0) {
  const query = readParam(params, "q");
  const status = AGENT_STATES.find((value) => value === readParam(params, "status"));
  return db
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
        status ? eq(agents.status, status) : undefined,
      ),
    )
    .orderBy(desc(agents.createdAt))
    .limit(limit)
    .offset(offset);
}

export function inactiveCondition() {
  return lt(users.lastSeenAt, sql`now() - make_interval(days => ${retentionDays()})`);
}

export function personRows(params: AdminSearchParams, limit: number, offset = 0) {
  const query = readParam(params, "q");
  const role = readParam(params, "role");
  const roleFilter: SQL | undefined =
    role === "admins"
      ? ne(users.platformRole, "member")
      : role === "exempt"
        ? eq(users.retentionExempt, true)
        : role === "inactive"
          ? and(inactiveCondition(), eq(users.retentionExempt, false))
          : undefined;
  return db
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
    .limit(limit)
    .offset(offset);
}

export const JOB_STATES = [
  "queued",
  "running",
  "awaiting_review",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
] as const;

// Joined rather than selected bare. A row that says only "running" and a job
// id is not something anyone can act on, so it has to say whose crawl it is,
// and a failure has to carry the message that explains it.
export function jobRows(params: AdminSearchParams, limit: number, offset = 0) {
  const query = readParam(params, "q");
  const status = JOB_STATES.find((value) => value === readParam(params, "status"));
  const workspaceId = readParam(params, "workspace");
  return db
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
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(crawlJobs)
    .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
    .innerJoin(agents, eq(agents.id, sources.agentId))
    .innerJoin(workspaces, eq(workspaces.id, agents.workspaceId))
    .where(
      and(
        status ? eq(crawlJobs.status, status) : undefined,
        workspaceId ? eq(workspaces.id, workspaceId) : undefined,
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
    .limit(limit)
    .offset(offset);
}

/** `expired` is a session whose restore point was pruned; see `lib/admin/retention.ts`. */
export const SESSION_STATES = ["open", "kept", "discarded", "reverted", "expired"] as const;

export function sessionRows(params: AdminSearchParams, limit: number, offset = 0) {
  const query = readParam(params, "q");
  const status = SESSION_STATES.find((value) => value === readParam(params, "status"));
  const workspaceId = readParam(params, "workspace");
  const adminEmail = readParam(params, "admin");
  return db
    .select({
      id: adminSessions.id,
      adminEmail: adminSessions.adminEmail,
      status: adminSessions.status,
      reason: adminSessions.reason,
      startedAt: adminSessions.startedAt,
      endedAt: adminSessions.endedAt,
      summary: adminSessions.summary,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(adminSessions)
    .innerJoin(workspaces, eq(workspaces.id, adminSessions.workspaceId))
    .where(
      and(
        status ? eq(adminSessions.status, status) : undefined,
        workspaceId ? eq(adminSessions.workspaceId, workspaceId) : undefined,
        adminEmail ? eq(adminSessions.adminEmail, adminEmail.toLowerCase()) : undefined,
        query
          ? or(ilike(workspaces.name, likePattern(query)), ilike(adminSessions.adminEmail, likePattern(query)))
          : undefined,
      ),
    )
    .orderBy(desc(adminSessions.startedAt))
    .limit(limit)
    .offset(offset);
}

export const auditArea = sql<string>`split_part(${auditLogs.action}, '.', 1)`;

export function auditRows(params: AdminSearchParams, limit: number, offset = 0) {
  const query = readParam(params, "q");
  const area = readParam(params, "area");
  const workspaceId = readParam(params, "workspace");
  const actor = readParam(params, "actor");
  return db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      message: auditLogs.message,
      actorEmail: auditLogs.actorEmail,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      workspaceId: auditLogs.workspaceId,
      metadata: auditLogs.metadata,
      ipAddress: auditLogs.ipAddress,
      requestId: auditLogs.requestId,
    })
    .from(auditLogs)
    .where(
      and(
        area ? eq(auditArea, area) : undefined,
        workspaceId ? eq(auditLogs.workspaceId, workspaceId) : undefined,
        actor ? eq(auditLogs.actorEmail, actor.toLowerCase()) : undefined,
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
    .limit(limit)
    .offset(offset);
}

export function logRows(params: AdminSearchParams, limit: number, offset = 0) {
  const query = readParam(params, "q");
  const level = readParam(params, "level");
  return db
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
    .limit(limit)
    .offset(offset);
}

export const QUALITY_WINDOWS = ["7", "30", "90"] as const;


export type QualityRow = {
  workspaceId: string | null;
  workspaceName: string | null;
  answers: number;
  grounded: number;
  ungrounded: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  thumbsUp: number;
  thumbsDown: number;
};


/**
 * Answer quality per workspace over a window.
 *
 * Reaches messages through conversations active in the window, because
 * `conversations` is indexed on its last message and `messages` has no index
 * on time alone: filtering conversations first keeps this from reading every
 * message ever sent. Sandbox chats are excluded; they are an administrator
 * reproducing a fault, and a fault reproduced twenty times would read as a
 * workspace in trouble.
 *
 * The last row, with a null workspace, is the whole installation.
 */
export async function qualityRows(params: AdminSearchParams) {
  const days = Number(QUALITY_WINDOWS.find((value) => value === readParam(params, "window")) ?? 30);
  const sort = readParam(params, "sort");
  const order =
    sort === "grounded"
      ? sql`(count(*) filter (where grounded) + count(*) filter (where grounded = false)) >= ${QUALITY_MIN_ANSWERS} desc,
            count(*) filter (where grounded)::float / nullif(count(*) filter (where grounded is not null), 0) asc nulls last`
      : sort === "slow"
        ? sql`percentile_cont(0.95) within group (order by latency_ms) desc nulls last`
        : sort === "feedback"
          ? sql`count(*) filter (where rating < 0) desc`
          : sql`count(*) desc`;

  const rows = await db.execute<QualityRow>(sql`
    with answered as (
      select a.workspace_id, m.grounded, m.latency_ms, f.rating
      from conversations c
      join agents a on a.id = c.agent_id
      join messages m on m.conversation_id = c.id
      left join feedback f on f.message_id = m.id
      where c.last_message_at >= now() - make_interval(days => ${days})
        and c.channel <> ${SANDBOX_CHANNEL}
        and m.role = 'assistant'
        and m.created_at >= now() - make_interval(days => ${days})
    )
    select
      w.id as "workspaceId",
      w.name as "workspaceName",
      count(*)::int as answers,
      count(*) filter (where grounded)::int as grounded,
      count(*) filter (where grounded = false)::int as ungrounded,
      round(avg(latency_ms))::int as "avgLatencyMs",
      round(percentile_cont(0.95) within group (order by latency_ms))::int as "p95LatencyMs",
      count(*) filter (where rating > 0)::int as "thumbsUp",
      count(*) filter (where rating < 0)::int as "thumbsDown"
    from answered
    join workspaces w on w.id = answered.workspace_id
    group by grouping sets ((w.id, w.name), ())
    order by grouping(w.id) asc, ${order}
    limit 201
  `);
  const all = [...rows];
  const total = all.find((row) => row.workspaceId === null) ?? null;
  return { days, sort, total, rows: all.filter((row) => row.workspaceId !== null) };
}

export const WAITING_TICKET_STATES = ["open", "pending"] as const;

export function waitingConversationRows(params: AdminSearchParams, limit: number, offset = 0) {
  const query = readParam(params, "q");
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      visitorName: conversations.visitorName,
      visitorEmail: conversations.visitorEmail,
      lastMessageAt: conversations.lastMessageAt,
      createdAt: conversations.createdAt,
      agentName: agents.name,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .innerJoin(workspaces, eq(workspaces.id, agents.workspaceId))
    .where(
      and(
        eq(conversations.status, "escalated"),
        ne(conversations.channel, SANDBOX_CHANNEL),
        query
          ? or(
              ilike(workspaces.name, likePattern(query)),
              ilike(conversations.title, likePattern(query)),
              ilike(conversations.visitorEmail, likePattern(query)),
              ilike(conversations.visitorName, likePattern(query)),
            )
          : undefined,
      ),
    )
    // Longest wait first: the conversation that has waited longest is the one
    // most likely to have been forgotten.
    .orderBy(asc(conversations.lastMessageAt))
    .limit(limit)
    .offset(offset);
}

const PRIORITY_ORDER = sql`case ${tickets.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;

export function waitingTicketRows(params: AdminSearchParams, limit: number, offset = 0) {
  const query = readParam(params, "q");
  return db
    .select({
      id: tickets.id,
      reference: tickets.reference,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      kind: tickets.kind,
      requesterEmail: tickets.requesterEmail,
      lastReplyBy: tickets.lastReplyBy,
      createdAt: tickets.createdAt,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(tickets)
    .innerJoin(workspaces, eq(workspaces.id, tickets.workspaceId))
    .where(
      and(
        inArray(tickets.status, [...WAITING_TICKET_STATES]),
        query
          ? or(
              ilike(workspaces.name, likePattern(query)),
              ilike(tickets.subject, likePattern(query)),
              ilike(tickets.reference, likePattern(query)),
              ilike(tickets.requesterEmail, likePattern(query)),
            )
          : undefined,
      ),
    )
    .orderBy(PRIORITY_ORDER, asc(tickets.createdAt))
    .limit(limit)
    .offset(offset);
}
