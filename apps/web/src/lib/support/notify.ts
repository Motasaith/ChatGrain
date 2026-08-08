import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema";
import { logger } from "@/lib/observability/logger";
import { sendSupportEmail } from "./mailer";

/**
 * Emails the requester that support replied.
 *
 * The in-widget unread badge already covers visitors who come back. This is
 * for the ones who do not: an anonymous ticket lives in localStorage, so
 * without an email the answer waits for a return visit that may never happen.
 */
export async function notifyTicketReply(
  conversationId: string,
  replyText: string,
) {
  try {
    const [ticket] = await db
      .select({
        id: tickets.id,
        reference: tickets.reference,
        subject: tickets.subject,
        requesterEmail: tickets.requesterEmail,
        requesterName: tickets.requesterName,
      })
      .from(tickets)
      .where(eq(tickets.conversationId, conversationId))
      .limit(1);
    if (!ticket?.requesterEmail) return;

    const greeting = ticket.requesterName ? `Hi ${ticket.requesterName},` : "Hi,";
    const sent = await sendSupportEmail({
      to: ticket.requesterEmail,
      subject: `Re: ${ticket.subject} [${ticket.reference}]`,
      text: [
        greeting,
        "",
        "Support has replied to your request:",
        "",
        replyText.trim(),
        "",
        `Reference: ${ticket.reference}`,
        "Open the chat widget on our site to reply.",
      ].join("\n"),
    });

    // Only stamped on a real send, so an install that adds credentials later
    // is not left with a backlog already marked as notified.
    if (sent) {
      await db
        .update(tickets)
        .set({ notifiedAt: new Date() })
        .where(eq(tickets.id, ticket.id));
    }
  } catch (error) {
    // Never surface this to the operator: their reply was saved.
    logger.error({ error, conversationId }, "Ticket reply notification failed");
  }
}
