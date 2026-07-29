import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizePublicAgent,
  visitorConversation,
} from "@/lib/chat/public-conversation";
import { db } from "@/lib/db/client";
import {
  conversations,
  messageAttachments,
  messages,
  tickets,
} from "@/lib/db/schema";
import { errorResponse, readJson } from "@/lib/http/errors";
import { rateLimit } from "@/lib/http/rate-limit";

type RouteContext = {
  params: Promise<{ agentId: string; conversationId: string }>;
};

const credentialsSchema = z.object({
  visitorId: z.string().uuid(),
  sessionId: z.string().trim().min(8).max(200),
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
    const { agentId, conversationId } = await context.params;
    const url = new URL(request.url);
    const credentials = credentialsSchema.parse({
      visitorId: url.searchParams.get("visitorId"),
      sessionId: url.searchParams.get("sessionId"),
    });
    await authorizePublicAgent(agentId, bearerToken(request));
    rateLimit(`thread:${conversationId}:${credentials.visitorId}`, 90, 60_000);
    const conversation = await visitorConversation({
      agentId,
      conversationId,
      ...credentials,
    });
    const [history, attachments, ticket] = await Promise.all([
      db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.createdAt)),
      db
        .select({
          id: messageAttachments.id,
          messageId: messageAttachments.messageId,
          kind: messageAttachments.kind,
          fileName: messageAttachments.fileName,
          mimeType: messageAttachments.mimeType,
          sizeBytes: messageAttachments.sizeBytes,
          durationMs: messageAttachments.durationMs,
          transcript: messageAttachments.transcript,
        })
        .from(messageAttachments)
        .where(eq(messageAttachments.conversationId, conversationId)),
      db
        .select({
          reference: tickets.reference,
          status: tickets.status,
          priority: tickets.priority,
        })
        .from(tickets)
        .where(eq(tickets.conversationId, conversationId))
        .limit(1),
    ]);
    const attachmentsByMessage = new Map<
      string,
      typeof attachments
    >();
    for (const attachment of attachments) {
      if (!attachment.messageId) continue;
      const current = attachmentsByMessage.get(attachment.messageId) ?? [];
      current.push(attachment);
      attachmentsByMessage.set(attachment.messageId, current);
    }
    return NextResponse.json(
      {
        data: {
          conversation: {
            id: conversation.id,
            sessionId: conversation.sessionId,
            title: conversation.title,
            status: conversation.status,
            ticket: ticket[0] ?? null,
          },
          messages: history.map((message) => ({
            ...message,
            attachments: attachmentsByMessage.get(message.id) ?? [],
          })),
        },
        requestId,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
export async function PATCH(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId, conversationId } = await context.params;
    const input = credentialsSchema.parse(await readJson(request, 10_000));
    await authorizePublicAgent(agentId, bearerToken(request));
    await visitorConversation({
      agentId,
      conversationId,
      visitorId: input.visitorId,
      sessionId: input.sessionId,
    });
    await db
      .update(conversations)
      .set({ visitorLastReadAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.agentId, agentId),
        ),
      );
    return NextResponse.json({ data: { read: true }, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
