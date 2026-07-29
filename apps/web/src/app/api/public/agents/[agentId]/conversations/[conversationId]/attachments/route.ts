import { NextResponse } from "next/server";
import { z } from "zod";
import {
  removeAttachment,
  saveAttachment,
} from "@/lib/chat/attachment-storage";
import {
  authorizePublicAgent,
  visitorConversation,
} from "@/lib/chat/public-conversation";
import { transcribeAudio } from "@/lib/chat/transcribe";
import { db } from "@/lib/db/client";
import { messageAttachments } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { rateLimit } from "@/lib/http/rate-limit";

type RouteContext = {
  params: Promise<{ agentId: string; conversationId: string }>;
};

const fieldsSchema = z.object({
  visitorId: z.string().uuid(),
  sessionId: z.string().trim().min(8).max(200),
  embedToken: z.string().max(2_000).optional(),
  kind: z.enum(["image", "audio"]),
  transcript: z.string().trim().max(4_000).optional(),
  durationMs: z.coerce.number().int().min(0).max(600_000).optional(),
});

export async function POST(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  let storageKey: string | undefined;
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 13_000_000) {
      throw new AppError(
        "ATTACHMENT_TOO_LARGE",
        "The attachment is too large.",
        413,
      );
    }
    const { agentId, conversationId } = await context.params;
    const form = await request.formData();
    const input = fieldsSchema.parse({
      visitorId: form.get("visitorId"),
      sessionId: form.get("sessionId"),
      embedToken: form.get("embedToken") || undefined,
      kind: form.get("kind"),
      transcript: form.get("transcript") || undefined,
      durationMs: form.get("durationMs") || undefined,
    });
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new AppError(
        "ATTACHMENT_REQUIRED",
        "Choose an image or recording.",
        422,
      );
    }
    await authorizePublicAgent(agentId, input.embedToken);
    await visitorConversation({
      agentId,
      conversationId,
      visitorId: input.visitorId,
      sessionId: input.sessionId,
    });
    rateLimit(`attachment:${conversationId}`, 12, 60_000);
    const stored = await saveAttachment(file, input.kind);
    storageKey = stored.storageKey;
    const transcript =
      input.kind === "audio"
        ? (await transcribeAudio(file)) || input.transcript
        : undefined;
    const [attachment] = await db
      .insert(messageAttachments)
      .values({
        conversationId,
        kind: input.kind,
        storageKey: stored.storageKey,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        durationMs: input.durationMs,
        transcript,
      })
      .returning({
        id: messageAttachments.id,
        kind: messageAttachments.kind,
        fileName: messageAttachments.fileName,
        mimeType: messageAttachments.mimeType,
        sizeBytes: messageAttachments.sizeBytes,
        durationMs: messageAttachments.durationMs,
        transcript: messageAttachments.transcript,
      });
    return NextResponse.json(
      { data: attachment, requestId },
      { status: 201 },
    );
  } catch (error) {
    if (storageKey) await removeAttachment(storageKey);
    return errorResponse(error, requestId);
  }
}
