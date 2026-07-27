import Link from "next/link";
import { Bot, ChevronRight, Inbox, MessageCircleMore } from "lucide-react";
import { desc, eq, sql } from "drizzle-orm";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, conversations, messages } from "@/lib/db/schema";
import { relativeTime } from "@/lib/format";

export default async function ActivityPage() {
  const workspace = await getWorkspaceContext();
  const rows = await db
    .select({
      id: conversations.id,
      agentName: agents.name,
      agentColor: agents.primaryColor,
      status: conversations.status,
      visitorName: conversations.visitorName,
      visitorEmail: conversations.visitorEmail,
      topic: conversations.topic,
      lastMessageAt: conversations.lastMessageAt,
      messageCount: sql<number>`count(${messages.id})::int`,
    })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .where(eq(agents.workspaceId, workspace.workspaceId))
    .groupBy(conversations.id, agents.id)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(100);

  return (
    <>
      <div className="page-heading">
        <div><span className="page-eyebrow">Activity</span><h1>Conversation inbox</h1><p>Review answers, citations, feedback, and handoffs.</p></div>
      </div>
      <section className="data-card">
        <div className="data-toolbar">
          <span><Inbox size={15} /> All conversations</span>
          <i>{rows.length} shown</i>
        </div>
        {rows.length ? (
          <div className="inbox-list">
            {rows.map((row) => (
              <Link href={`/dashboard/activity/${row.id}`} key={row.id}>
                <span className="conversation-avatar" style={{ background: row.agentColor }}>
                  {(row.visitorName || "V")[0].toUpperCase()}
                </span>
                <div>
                  <b>{row.visitorName || row.visitorEmail || "Anonymous visitor"}</b>
                  <small>{row.topic || "General question"} · {row.agentName}</small>
                </div>
                <span><MessageCircleMore size={12} /> {row.messageCount}</span>
                <i className={`status-pill status-${row.status}`}>{row.status}</i>
                <time>{relativeTime(row.lastMessageAt)}</time>
                <ChevronRight size={15} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="data-empty"><Bot size={25} /><b>No conversations yet</b><span>Messages from your playground and widgets will appear here.</span></div>
        )}
      </section>
    </>
  );
}
