import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  readAttachment,
  removeAttachment,
} from "@/lib/chat/attachment-storage";
import {
  authorizePublicAgent,
  visitorConversation,
} from "@/lib/chat/public-conversation";
import { db } from "@/lib/db/client";
import { messageAttachments } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";

type RouteContext = {
  params: Promise<{
    agentId: string;
    conversationId: string;
    attachmentId: string;
  }>;
};

const querySchema = z.object({
  visitorId: z.string().uuid(),
  sessionId: z.string().trim().min(8).max(200),
  token: z.string().max(2_000).optional(),
});

export async function GET(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId, conversationId, attachmentId } = await context.params;
    const url = new URL(request.url);
    const input = querySchema.parse({
      visitorId: url.searchParams.get("visitorId"),
      sessionId: url.searchParams.get("sessionId"),
      token: url.searchParams.get("token") || undefined,
    });
    await authorizePublicAgent(agentId, input.token);
    await visitorConversation({
      agentId,
      conversationId,
      visitorId: input.visitorId,
      sessionId: input.sessionId,
    });
    const [attachment] = await db
      .select()
      .from(messageAttachments)
      .where(
        and(
          eq(messageAttachments.id, attachmentId),
          eq(messageAttachments.conversationId, conversationId),
        ),
      )
      .limit(1);
    if (!attachment) {
      throw new AppError(
        "ATTACHMENT_NOT_FOUND",
        "Attachment not found.",
        404,
      );
    }
    const bytes = await readAttachment(attachment.storageKey);
    return new Response(bytes, {
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(bytes.byteLength),
        "content-disposition": `inline; filename="${attachment.fileName.replace(/["\r\n]/g, "")}"`,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId, conversationId, attachmentId } = await context.params;
    const url = new URL(request.url);
    const input = querySchema.parse({
      visitorId: url.searchParams.get("visitorId"),
      sessionId: url.searchParams.get("sessionId"),
      token: url.searchParams.get("token") || undefined,
    });
    await authorizePublicAgent(agentId, input.token);
    await visitorConversation({
      agentId,
      conversationId,
      visitorId: input.visitorId,
      sessionId: input.sessionId,
    });
    const [attachment] = await db
      .select()
      .from(messageAttachments)
      .where(
        and(
          eq(messageAttachments.id, attachmentId),
          eq(messageAttachments.conversationId, conversationId),
        ),
      )
      .limit(1);
    if (!attachment || attachment.messageId) {
      throw new AppError(
        "ATTACHMENT_NOT_FOUND",
        "Pending attachment not found.",
        404,
      );
    }
    await db
      .delete(messageAttachments)
      .where(eq(messageAttachments.id, attachment.id));
    await removeAttachment(attachment.storageKey);
    return Response.json({ data: { deleted: true }, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
