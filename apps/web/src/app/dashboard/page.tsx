import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  MessageCircleMore,
  Plus,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  UsersRound,
} from "lucide-react";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { DatabaseSetup } from "@/components/app/database-setup";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import {
  agents,
  conversations,
  feedback,
  messages,
  sources,
} from "@/lib/db/schema";

async function loadDashboard() {
  const context = await getWorkspaceContext();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const workspaceAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, context.workspaceId))
    .orderBy(desc(agents.updatedAt))
    .limit(6);

  const [stats] = await db
    .select({
      conversations: count(conversations.id),
      resolved: sql<number>`count(*) filter (where ${conversations.status} = 'resolved')::int`,
      users: sql<number>`count(distinct ${conversations.sessionId})::int`,
    })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(
      and(
        eq(agents.workspaceId, context.workspaceId),
        gte(conversations.createdAt, weekAgo),
      ),
    );

  const [feedbackStats] = await db
    .select({
      positive:
        sql<number>`count(*) filter (where ${feedback.rating} > 0)::int`,
      total: count(feedback.id),
    })
    .from(feedback)
    .innerJoin(messages, eq(messages.id, feedback.messageId))
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(eq(agents.workspaceId, context.workspaceId));

  const recent = await db
    .select({
      id: conversations.id,
      status: conversations.status,
      visitorName: conversations.visitorName,
      topic: conversations.topic,
      lastMessageAt: conversations.lastMessageAt,
      agentName: agents.name,
    })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(eq(agents.workspaceId, context.workspaceId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(5);

  const agentSources = workspaceAgents.length
    ? await db
        .select({ agentId: sources.agentId, count: count(sources.id) })
        .from(sources)
        .where(inArray(sources.agentId, workspaceAgents.map((agent) => agent.id)))
        .groupBy(sources.agentId)
    : [];

  return {
    context,
    agents: workspaceAgents.map((agent) => ({
      ...agent,
      sourceCount:
        agentSources.find((item) => item.agentId === agent.id)?.count ?? 0,
    })),
    stats: {
      conversations: stats?.conversations ?? 0,
      resolutionRate: stats?.conversations
        ? Math.round((Number(stats.resolved) / stats.conversations) * 100)
        : 0,
      users: Number(stats?.users ?? 0),
      csat: feedbackStats?.total
        ? Math.round(
            (Number(feedbackStats.positive) / feedbackStats.total) * 100,
          )
        : 0,
    },
    recent,
  };
}

export default async function DashboardPage() {
  let data: Awaited<ReturnType<typeof loadDashboard>>;
  try {
    data = await loadDashboard();
  } catch (error) {
    return (
      <DatabaseSetup
        detail={error instanceof Error ? error.message : undefined}
      />
    );
  }

  const firstName = data.context.name.split(" ")[0];

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Overview</span>
          <h1>Good to see you, {firstName}.</h1>
          <p>Here is what your agents have handled in the last seven days.</p>
        </div>
        <Link className="app-primary-button" href="/dashboard/agents/new">
          <Plus size={16} /> New agent
        </Link>
      </div>

      <div className="stats-grid">
        <article className="stat-card">
          <div>
            <span>Conversations</span>
            <MessageCircleMore size={17} />
          </div>
          <strong>{data.stats.conversations.toLocaleString()}</strong>
          <small>Last 7 days</small>
        </article>
        <article className="stat-card">
          <div>
            <span>Resolution rate</span>
            <ShieldCheck size={17} />
          </div>
          <strong>{data.stats.resolutionRate}%</strong>
          <small>Without an operator</small>
        </article>
        <article className="stat-card">
          <div>
            <span>Unique visitors</span>
            <UsersRound size={17} />
          </div>
          <strong>{data.stats.users.toLocaleString()}</strong>
          <small>Across all agents</small>
        </article>
        <article className="stat-card">
          <div>
            <span>Helpful answers</span>
            <ThumbsUp size={17} />
          </div>
          <strong>{data.stats.csat || "—"}{data.stats.csat ? "%" : ""}</strong>
          <small>From visitor feedback</small>
        </article>
      </div>

      {data.agents.length === 0 ? (
        <section className="first-agent-card">
          <div className="first-agent-copy">
            <span className="first-agent-icon">
              <Sparkles size={20} />
            </span>
            <h2>Build your first support agent</h2>
            <p>
              Start with your website. Docent will discover pages, extract the
              useful content, detect your brand, and prepare a widget.
            </p>
            <Link href="/dashboard/agents/new" className="app-primary-button">
              Train from a URL <ArrowRight size={16} />
            </Link>
          </div>
          <div className="first-agent-steps">
            {[
              "Inspect site and brand",
              "Crawl and index pages",
              "Test grounded answers",
              "Install the widget",
            ].map((step, index) => (
              <div key={step}>
                <span>0{index + 1}</span>
                <b>{step}</b>
                {index === 0 ? (
                  <span className="step-state active">Ready</span>
                ) : (
                  <ChevronRight size={15} />
                )}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="dashboard-grid">
          <section className="app-card">
            <div className="app-card-head">
              <div>
                <h2>Your agents</h2>
                <p>Knowledge, deployment, and recent activity.</p>
              </div>
              <Link href="/dashboard/agents">
                View all <ArrowRight size={13} />
              </Link>
            </div>
            <div className="agent-list">
              {data.agents.map((agent) => (
                <Link
                  className="agent-list-row"
                  href={`/dashboard/agents/${agent.id}`}
                  key={agent.id}
                >
                  <span
                    className="agent-list-avatar"
                    style={{ background: agent.primaryColor }}
                  >
                    {agent.name[0]}
                  </span>
                  <span className="agent-list-copy">
                    <b>{agent.name}</b>
                    <small>
                      {agent.sourceCount} sources · {agent.status}
                    </small>
                  </span>
                  <span className={`status-pill status-${agent.status}`}>
                    {agent.status === "ready" && <CheckCircle2 size={11} />}
                    {agent.status}
                  </span>
                  <ChevronRight size={16} />
                </Link>
              ))}
            </div>
          </section>

          <section className="app-card">
            <div className="app-card-head">
              <div>
                <h2>Recent conversations</h2>
                <p>Latest questions across your widgets.</p>
              </div>
              <Link href="/dashboard/activity">
                Open inbox <ArrowRight size={13} />
              </Link>
            </div>
            {data.recent.length ? (
              <div className="conversation-list">
                {data.recent.map((conversation) => (
                  <Link
                    href={`/dashboard/activity/${conversation.id}`}
                    key={conversation.id}
                  >
                    <span className="conversation-avatar">
                      {(conversation.visitorName ?? "V")[0]}
                    </span>
                    <span>
                      <b>{conversation.visitorName ?? "Anonymous visitor"}</b>
                      <small>
                        {conversation.topic ?? "General question"} ·{" "}
                        {conversation.agentName}
                      </small>
                    </span>
                    <em>{conversation.status}</em>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="compact-empty">
                <Bot size={24} />
                <b>No conversations yet</b>
                <span>Test an agent or install its widget to see activity.</span>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
