import { BarChart3, Bot, MessageCircleMore, ShieldCheck, ThumbsUp, Timer, UsersRound } from "lucide-react";
import { eq, sql } from "drizzle-orm";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, conversations, feedback, messages } from "@/lib/db/schema";

export default async function AnalyticsPage() {
  const workspace = await getWorkspaceContext();
  const [summary] = await db
    .select({
      conversations: sql<number>`count(distinct ${conversations.id})::int`,
      visitors: sql<number>`count(distinct ${conversations.sessionId})::int`,
      resolved: sql<number>`count(distinct ${conversations.id}) filter (where ${conversations.status} = 'resolved')::int`,
      averageLatency: sql<number>`coalesce(avg(${messages.latencyMs}) filter (where ${messages.role} = 'assistant'), 0)::int`,
    })
    .from(agents)
    .leftJoin(conversations, eq(conversations.agentId, agents.id))
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .where(eq(agents.workspaceId, workspace.workspaceId));
  const [ratings] = await db
    .select({
      positive: sql<number>`count(*) filter (where ${feedback.rating} = 1)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(feedback)
    .innerJoin(messages, eq(messages.id, feedback.messageId))
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(eq(agents.workspaceId, workspace.workspaceId));
  const series = await db.execute<{
    day: string;
    value: number;
  }>(sql`
    with days as (
      select generate_series(current_date - interval '13 days', current_date, interval '1 day')::date as day
    )
    select to_char(days.day, 'Mon DD') as day, count(c.id)::int as value
    from days
    left join ${conversations} c on c.created_at::date = days.day
    left join ${agents} a on a.id = c.agent_id and a.workspace_id = ${workspace.workspaceId}
    group by days.day order by days.day
  `);
  const max = Math.max(1, ...series.map((row) => Number(row.value)));
  const csat = ratings?.total ? Math.round(Number(ratings.positive) / Number(ratings.total) * 100) : 0;
  const resolution = summary?.conversations ? Math.round(Number(summary.resolved) / Number(summary.conversations) * 100) : 0;

  return (
    <>
      <div className="page-heading">
        <div><span className="page-eyebrow">Analytics</span><h1>Answer quality at a glance</h1><p>Measure usage, speed, resolution, and visitor feedback.</p></div>
      </div>
      <div className="stats-grid">
        <Metric icon={MessageCircleMore} label="Conversations" value={Number(summary?.conversations || 0).toLocaleString()} detail="All time" />
        <Metric icon={ShieldCheck} label="Resolution rate" value={`${resolution}%`} detail="Marked resolved" />
        <Metric icon={ThumbsUp} label="Helpful answers" value={ratings?.total ? `${csat}%` : "—"} detail={`${Number(ratings?.total || 0)} ratings`} />
        <Metric icon={Timer} label="Average response" value={`${Number(summary?.averageLatency || 0)} ms`} detail="Server latency" />
      </div>
      <div className="analytics-grid">
        <section className="data-card chart-card">
          <div className="data-toolbar"><span><BarChart3 size={15} /> Conversation volume</span><i>Last 14 days</i></div>
          <div className="bar-chart">
            {series.map((row) => (
              <div key={row.day}>
                <span title={`${row.day}: ${row.value}`} style={{ height: `${Math.max(3, Number(row.value) / max * 100)}%` }} />
                <small>{row.day.split(" ")[1]}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="data-card quality-card">
          <div className="data-toolbar"><span><Bot size={15} /> Quality signals</span></div>
          <div className="quality-ring" style={{ "--quality": `${csat * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{ratings?.total ? `${csat}%` : "—"}</strong><small>helpful</small></div>
          </div>
          <p>Collect more visitor feedback to make this signal more representative.</p>
          <div className="quality-row"><span><UsersRound size={13} /> Unique visitors</span><b>{Number(summary?.visitors || 0)}</b></div>
        </section>
      </div>
    </>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Bot; label: string; value: string; detail: string }) {
  return <article className="stat-card"><div><span>{label}</span><Icon size={17} /></div><strong>{value}</strong><small>{detail}</small></article>;
}
