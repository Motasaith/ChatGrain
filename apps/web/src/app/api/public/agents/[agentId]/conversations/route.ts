import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizePublicAgent,
} from "@/lib/chat/public-conversation";
import { db } from "@/lib/db/client";
import {
  conversations,
  messages,
  tickets,
} from "@/lib/db/schema";
import { errorResponse, readJson } from "@/lib/http/errors";
import { rateLimit } from "@/lib/http/rate-limit";

type RouteContext = { params: Promise<{ agentId: string }> };

const visitorId = z.string().uuid();
const createSchema = z.object({
  visitorId,
  sessionId: z.string().trim().min(8).max(200),
  embedToken: z.string().max(2_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : undefined;
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await context.params;
    const url = new URL(request.url);
    const externalUserId = visitorId.parse(url.searchParams.get("visitorId"));
    await authorizePublicAgent(agentId, bearerToken(request));
    rateLimit(`history:${agentId}:${externalUserId}`, 60, 60_000);
    const rows = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.agentId, agentId),
          eq(conversations.externalUserId, externalUserId),
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(30);
    if (!rows.length) {
      return NextResponse.json(
        { data: { conversations: [] }, requestId },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const ids = rows.map((row) => row.id);
    const [conversationMessages, ticketRows] = await Promise.all([
      db
        .select({
          conversationId: messages.conversationId,
          role: messages.role,
          content: messages.content,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(inArray(messages.conversationId, ids))
        .orderBy(asc(messages.createdAt)),
      db
        .select({
          conversationId: tickets.conversationId,
          reference: tickets.reference,
          status: tickets.status,
          priority: tickets.priority,
        })
        .from(tickets)
        .where(inArray(tickets.conversationId, ids)),
    ]);
    const ticketByConversation = new Map(
      ticketRows.map((ticket) => [ticket.conversationId, ticket]),
    );
    const data = rows.map((conversation) => {
      const history = conversationMessages.filter(
        (message) => message.conversationId === conversation.id,
      );
      const firstUser = history.find((message) => message.role === "user");
      const last = history.at(-1);
      const unreadCount = history.filter(
        (message) =>
          message.role === "operator" &&
          (!conversation.visitorLastReadAt ||
            message.createdAt > conversation.visitorLastReadAt),
      ).length;
      return {
        id: conversation.id,
        sessionId: conversation.sessionId,
        title:
          conversation.title ||
          firstUser?.content.slice(0, 90) ||
          "New conversation",
        status: conversation.status,
        lastMessageAt: conversation.lastMessageAt,
        lastMessage: last?.content.slice(0, 140) || "",
        lastMessageRole: last?.role,
        unreadCount,
        ticket: ticketByConversation.get(conversation.id) ?? null,
      };
    });
    return NextResponse.json(
      { data: { conversations: data }, requestId },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
export async function POST(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await context.params;
    const input = createSchema.parse(await readJson(request, 20_000));
    await authorizePublicAgent(agentId, input.embedToken);
    rateLimit(`new-chat:${agentId}:${input.visitorId}`, 15, 60_000);
    const [existing] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.agentId, agentId),
          eq(conversations.externalUserId, input.visitorId),
          eq(conversations.sessionId, input.sessionId),
        ),
      )
      .limit(1);
    if (existing) {
      return NextResponse.json({ data: existing, requestId });
    }
    const [conversation] = await db
      .insert(conversations)
      .values({
        agentId,
        externalUserId: input.visitorId,
        sessionId: input.sessionId,
        metadata: input.metadata ?? {},
      })
      .returning();
    return NextResponse.json(
      { data: conversation, requestId },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
