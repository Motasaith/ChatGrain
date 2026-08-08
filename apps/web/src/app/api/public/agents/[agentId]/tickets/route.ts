import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { conversations, messages, tickets } from "@/lib/db/schema";
import { authorizePublicAgent } from "@/lib/chat/public-conversation";
import { errorResponse, readJson } from "@/lib/http/errors";

/**
 * Opens a support ticket straight from the help centre.
 *
 * Distinct from the in-chat lead form on purpose. That form exists to capture
 * a contact when the assistant cannot answer; this is someone deliberately
 * filing a request, so it creates a ticket as the primary record rather than
 * as a side effect of lead capture.
 */
const ticketSchema = z.object({
  visitorId: z.string().min(8).max(200),
  sessionId: z.string().min(8).max(200).optional(),
  kind: z.enum(["support", "bug", "live"]),
  subject: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(4_000),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  name: z.string().trim().max(120).optional(),
  /** Bug reports carry the page they were filed from. */
  pageUrl: z.string().trim().max(500).optional(),
});

type RouteContext = { params: Promise<{ agentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await context.params;
    const input = ticketSchema.parse(await readJson(request, 20_000));
    const authorization = request.headers.get("authorization") || "";
    const agent = await authorizePublicAgent(
      agentId,
      authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined,
    );

    // A ticket always starts its own thread: filing a bug report should not
    // append to whatever the visitor happened to be asking the assistant.
    const [conversation] = await db
      .insert(conversations)
      .values({
        agentId: agent.id,
        sessionId: input.sessionId || crypto.randomUUID(),
        externalUserId: input.visitorId,
      })
      .returning();

    const priority = input.kind === "bug" ? "high" : "normal";
    const result = await db.transaction(async (tx) => {
      // The visitor's own words become the opening message, so the thread
      // reads as a conversation rather than a form submission with no context.
      await tx.insert(messages).values({
        conversationId: conversation.id,
        role: "user",
        content: input.body,
      });
      await tx
        .update(conversations)
        .set({
          status: "escalated",
          title: input.subject,
          topic: input.kind === "bug" ? "Bug report" : "Support request",
          visitorName: input.name || null,
          visitorEmail: input.email || null,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversation.id));

      const [ticket] = await tx
        .insert(tickets)
        .values({
          reference: `TKT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          conversationId: conversation.id,
          subject: input.subject,
          kind: input.kind,
          priority,
          requesterName: input.name || null,
          requesterEmail: input.email || null,
          lastReplyBy: "visitor",
          details: input.pageUrl ? { pageUrl: input.pageUrl } : {},
        })
        // One ticket per conversation. Filing again reopens the existing one
        // rather than failing on the unique index.
        .onConflictDoUpdate({
          target: tickets.conversationId,
          set: {
            subject: input.subject,
            kind: input.kind,
            priority,
            status: "open",
            requesterName: input.name || null,
            requesterEmail: input.email || null,
            lastReplyBy: "visitor",
            resolvedAt: null,
            notifiedAt: null,
            updatedAt: new Date(),
          },
        })
        .returning();
      return ticket;
    });

    return NextResponse.json(
      {
        data: {
          conversationId: conversation.id,
          sessionId: conversation.sessionId,
          reference: result?.reference ?? null,
          status: result?.status ?? "open",
        },
        requestId,
      },
      { headers: { "access-control-allow-origin": "*" } },
    );
  } catch (error) {
    const response = errorResponse(error, requestId);
    response.headers.set("access-control-allow-origin", "*");
    return response;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
    },
  });
}
