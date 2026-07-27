import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, Bot, ExternalLink, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConversationActions } from "@/components/app/conversation-actions";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, conversations, messages } from "@/lib/db/schema";

export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const [{ conversationId }, workspace] = await Promise.all([params, getWorkspaceContext()]);
  const [conversation] = await db
    .select({ conversation: conversations, agent: agents })
    .from(conversations)
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .where(and(eq(conversations.id, conversationId), eq(agents.workspaceId, workspace.workspaceId)))
    .limit(1);
  if (!conversation) notFound();
  const history = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));

  return (
    <>
      <Link href="/dashboard/activity" className="quiet-back-link"><ArrowLeft size={14} /> Conversations</Link>
      <div className="conversation-page">
        <section className="conversation-transcript">
          <div className="panel-heading">
            <div><h2>{conversation.conversation.visitorName || "Anonymous visitor"}</h2><p>{conversation.agent.name} · {history.length} messages</p></div>
            <i className={`status-pill status-${conversation.conversation.status}`}>{conversation.conversation.status}</i>
          </div>
          <div className="transcript">
            {history.map((message) => (
              <article className={`transcript-${message.role}`} key={message.id}>
                <span>{message.role === "user" ? <UserRound size={14} /> : <Bot size={14} />}</span>
                <div>
                  <small>{message.role === "operator" ? "Operator" : message.role}</small>
                  <p>{message.content}</p>
                  {message.citations?.length ? (
                    <div className="transcript-sources">
                      <b><ShieldCheck size={11} /> Sources</b>
                      {message.citations.map((citation) => (
                        citation.url ? <a href={citation.url} key={citation.chunkId} rel="noreferrer" target="_blank">{citation.title}<ExternalLink size={10} /></a> : <span key={citation.chunkId}>{citation.title}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
        <aside>
          <ConversationActions conversationId={conversationId} initialStatus={conversation.conversation.status} />
          <div className="visitor-card">
            <h3>Visitor</h3>
            <dl>
              <div><dt>Email</dt><dd>{conversation.conversation.visitorEmail || "Not provided"}</dd></div>
              <div><dt>Session</dt><dd>{conversation.conversation.sessionId.slice(0, 12)}…</dd></div>
              <div><dt>Channel</dt><dd>{conversation.conversation.channel}</dd></div>
            </dl>
          </div>
        </aside>
      </div>
    </>
  );
}
