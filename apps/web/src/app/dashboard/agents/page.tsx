import Link from "next/link";
import {
  Bot,
  ChevronRight,
  Globe2,
  MessageCircleMore,
  Plus,
} from "lucide-react";
import { count, desc, eq, inArray } from "drizzle-orm";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, conversations, sources } from "@/lib/db/schema";

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
  const conversationCounts = ids.length
    ? await db
        .select({ agentId: conversations.agentId, value: count(conversations.id) })
        .from(conversations)
        .where(inArray(conversations.agentId, ids))
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
            <Link href={`/dashboard/agents/${agent.id}`} key={agent.id}>
              <div className="agent-card-top">
                <span style={{ background: agent.primaryColor }}>
                  {agent.logoUrl || agent.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={agent.logoUrl || agent.iconUrl || ""} />
                  ) : agent.name[0]}
                </span>
                <i className={`status-pill status-${agent.status}`}>
                  {agent.status}
                </i>
                <ChevronRight size={17} />
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
          ))}
        </div>
      )}
    </>
  );
}
