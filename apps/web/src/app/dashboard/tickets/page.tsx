import { desc, eq } from "drizzle-orm";
import {
  AlertCircle,
  ChevronRight,
  CircleCheck,
  TicketCheck,
} from "lucide-react";
import Link from "next/link";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, conversations, tickets } from "@/lib/db/schema";
import { relativeTime } from "@/lib/format";

export default async function TicketsPage() {
  const workspace = await getWorkspaceContext();
  const rows = await db
    .select({
      id: tickets.id,
      reference: tickets.reference,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      requesterName: tickets.requesterName,
      requesterEmail: tickets.requesterEmail,
      conversationId: tickets.conversationId,
      agentName: agents.name,
      lastMessageAt: conversations.lastMessageAt,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .innerJoin(agents, eq(agents.id, tickets.agentId))
    .innerJoin(
      conversations,
      eq(conversations.id, tickets.conversationId),
    )
    .where(eq(tickets.workspaceId, workspace.workspaceId))
    .orderBy(desc(tickets.updatedAt))
    .limit(200);
  const openCount = rows.filter(
    (ticket) => !["resolved", "closed"].includes(ticket.status),
  ).length;
  const urgentCount = rows.filter(
    (ticket) =>
      ticket.priority === "urgent" &&
      !["resolved", "closed"].includes(ticket.status),
  ).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Support operations</span>
          <h1>Tickets</h1>
          <p>
            Track every human handoff until the customer receives a final
            answer.
          </p>
        </div>
      </div>
      <div className="ticket-summary-grid">
        <article>
          <TicketCheck size={18} />
          <span><b>{openCount}</b><small>Open tickets</small></span>
        </article>
        <article>
          <AlertCircle size={18} />
          <span><b>{urgentCount}</b><small>Urgent tickets</small></span>
        </article>
        <article>
          <CircleCheck size={18} />
          <span>
            <b>{rows.length - openCount}</b>
            <small>Resolved or closed</small>
          </span>
        </article>
      </div>
      <section className="data-card">
        <div className="data-toolbar">
          <span><TicketCheck size={15} /> Ticket queue</span>
          <i>{rows.length} shown</i>
        </div>
        {rows.length ? (
          <div className="ticket-list">
            {rows.map((ticket) => (
              <Link
                href={`/dashboard/activity/${ticket.conversationId}`}
                key={ticket.id}
              >
                <span className={`ticket-priority priority-${ticket.priority}`} />
                <div>
                  <span>
                    <b>{ticket.reference}</b>
                    <i>{ticket.priority}</i>
                  </span>
                  <h2>{ticket.subject}</h2>
                  <small>
                    {ticket.requesterName ||
                      ticket.requesterEmail ||
                      "Anonymous visitor"}{" "}
                    · {ticket.agentName}
                  </small>
                </div>
                <i className={`status-pill ticket-status-${ticket.status}`}>
                  {ticket.status.replaceAll("_", " ")}
                </i>
                <time>{relativeTime(ticket.lastMessageAt)}</time>
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="data-empty">
            <TicketCheck size={25} />
            <b>No tickets yet</b>
            <span>
              A ticket is created automatically when a visitor asks for human
              support.
            </span>
          </div>
        )}
      </section>
    </>
  );
}
