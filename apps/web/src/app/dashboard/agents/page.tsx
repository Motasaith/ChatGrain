import Link from "next/link";
import {
  Bot,
  Globe2,
  MessageCircleMore,
  Plus,
} from "lucide-react";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, conversations, crawlJobs, sources } from "@/lib/db/schema";
import { SANDBOX_CHANNEL } from "@/lib/chat/sandbox";
import { agentDisplayStatus } from "@/lib/agents/display-status";
import { AgentDeleteButton } from "@/components/app/agent-delete-button";
import { AgentCardActions } from "@/components/app/agent-card-actions";
import { LinkPending } from "@/components/app/link-pending";

export default async function AgentsPage() {
  const workspace = await getWorkspaceContext();
  const list = await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, workspace.workspaceId))
    .orderBy(desc(agents.updatedAt));
  const ids = list.map((agent) => agent.id);
  const sourceCounts = ids.length
    ? await db
        .select({ agentId: sources.agentId, value: count(sources.id) })
        .from(sources)
        .where(inArray(sources.agentId, ids))
        .groupBy(sources.agentId)
    : [];
  // Which agents are waiting on somebody rather than on the worker. Stored as
  // "training" because there is no other status for it, which reads as stuck.
  const awaitingReview = ids.length
    ? await db
        .selectDistinct({ agentId: sources.agentId })
        .from(crawlJobs)
        .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
        .where(
          and(
            inArray(sources.agentId, ids),
            eq(crawlJobs.status, "awaiting_review"),
          ),
        )
    : [];
  const reviewing = new Set(awaitingReview.map((row) => row.agentId));

  const conversationCounts = ids.length
    ? await db
        .select({ agentId: conversations.agentId, value: count(conversations.id) })
        .from(conversations)
        .where(
          and(
            inArray(conversations.agentId, ids),
            ne(conversations.channel, SANDBOX_CHANNEL),
          ),
        )
        .groupBy(conversations.agentId)
    : [];

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Agents</span>
          <h1>Your AI support team</h1>
          <p>Train, test, customize, and deploy each agent independently.</p>
        </div>
        <Link className="app-primary-button" href="/dashboard/agents/new">
          <Plus size={16} /> New agent
        </Link>
      </div>

      {list.length === 0 ? (
        <section className="wide-empty">
          <span><Bot size={25} /></span>
          <h2>No agents yet</h2>
          <p>Create an agent from a URL or start with an empty knowledge base.</p>
          <Link className="app-primary-button" href="/dashboard/agents/new">
            Build your first agent
          </Link>
        </section>
      ) : (
        <div className="agent-cards">
          {list.map((agent) => (
            // The delete control is a sibling of the link, never nested inside
            // it, so clicking either one cannot depend on hit testing.
            <div className="agent-card-wrap" key={agent.id}>
            <Link href={`/dashboard/agents/${agent.id}`}>
              <div className="agent-card-top">
                <span style={{ background: agent.primaryColor }}>
                  {agent.logoUrl || agent.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={agent.logoUrl || agent.iconUrl || ""} />
                  ) : agent.name[0]}
                </span>
                {(() => {
                  const shown = agentDisplayStatus(agent.status, {
                    awaitingReview: reviewing.has(agent.id),
                  });
                  return (
                    <i className={`status-pill status-${shown.tone}`}>
                      {shown.label}
                    </i>
                  );
                })()}
                <LinkPending />
              </div>
              <h2>{agent.name}</h2>
              <p>{agent.description || "Grounded support agent"}</p>
              <div className="agent-card-metrics">
                <span><Globe2 size={13} />{
                  sourceCounts.find((row) => row.agentId === agent.id)?.value ?? 0
                } sources</span>
                <span><MessageCircleMore size={13} />{
                  conversationCounts.find((row) => row.agentId === agent.id)?.value ?? 0
                } chats</span>
              </div>
            </Link>
            {/* A row of siblings, never nested in the link: a button inside an
                anchor only reaches the right handler if hit testing is exactly
                right, and none of these are places to rely on that. */}
            <span className="agent-card-tools">
            <AgentCardActions agentId={agent.id} agentName={agent.name} />
            <AgentDeleteButton
              agentId={agent.id}
              agentName={agent.name}
              conversationCount={
                conversationCounts.find((row) => row.agentId === agent.id)
                  ?.value ?? 0
              }
              sourceCount={
                sourceCounts.find((row) => row.agentId === agent.id)?.value ?? 0
              }
            />
            </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
