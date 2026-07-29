import { and, eq } from "drizzle-orm";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { readAttachment } from "@/lib/chat/attachment-storage";
import { db } from "@/lib/db/client";
import {
  agents,
  conversations,
  messageAttachments,
} from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";

type RouteContext = {
  params: Promise<{ conversationId: string; attachmentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const [{ conversationId, attachmentId }, workspace] = await Promise.all([
      context.params,
      getWorkspaceContext(),
    ]);
    const [attachment] = await db
      .select({
        storageKey: messageAttachments.storageKey,
        fileName: messageAttachments.fileName,
        mimeType: messageAttachments.mimeType,
        sizeBytes: messageAttachments.sizeBytes,
      })
      .from(messageAttachments)
      .innerJoin(
        conversations,
        eq(conversations.id, messageAttachments.conversationId),
      )
      .innerJoin(agents, eq(agents.id, conversations.agentId))
      .where(
        and(
          eq(messageAttachments.id, attachmentId),
          eq(messageAttachments.conversationId, conversationId),
          eq(agents.workspaceId, workspace.workspaceId),
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
