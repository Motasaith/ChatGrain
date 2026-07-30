import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  answerQuestion,
  referencesConversationImage,
} from "@/lib/chat/answer";
import { readAttachment } from "@/lib/chat/attachment-storage";
import { db } from "@/lib/db/client";
import {
  agents,
  conversations,
  messageAttachments,
  messages,
  tickets,
} from "@/lib/db/schema";
import { AppError, errorResponse, readJson } from "@/lib/http/errors";
import { rateLimit } from "@/lib/http/rate-limit";
import {
  domainAllowed,
  verifyWidgetToken,
} from "@/lib/security/widget-token";
import {
  defaultLlmModel,
  describeImagesForSearch,
} from "@/lib/llm/client";

const chatSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  sessionId: z.string().trim().min(8).max(200),
  conversationId: z.uuid().optional(),
  externalUserId: z.string().trim().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  embedToken: z.string().max(2_000).optional(),
  attachmentIds: z.array(z.uuid()).max(3).default([]),
});

type RouteContext = { params: Promise<{ agentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  try {
    const { agentId } = await context.params;
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || "local";
    rateLimit(`${agentId}:${ip}`, 40, 60_000);
    const input = chatSchema.parse(await readJson(request, 100_000));
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent || agent.status === "paused") {
      throw new AppError("AGENT_NOT_AVAILABLE", "Agent is not available.", 404);
    }
    if (agent.allowedDomains.length) {
      if (!input.embedToken) {
        throw new AppError(
          "WIDGET_TOKEN_REQUIRED",
          "This agent requires an authorized widget session.",
          403,
        );
      }
      const token = await verifyWidgetToken(input.embedToken, agent.id);
      if (
        token.host !== "__dashboard__" &&
        !domainAllowed(token.host, agent.allowedDomains)
      ) {
        throw new AppError(
          "DOMAIN_NOT_ALLOWED",
          "This agent is not allowed on the requesting domain.",
          403,
        );
      }
    }

    let conversation;
    if (input.conversationId) {
      [conversation] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.agentId, agentId),
            eq(conversations.sessionId, input.sessionId),
            ...(input.externalUserId
              ? [eq(conversations.externalUserId, input.externalUserId)]
              : []),
          ),
        )
        .limit(1);
      if (!conversation) {
        throw new AppError(
          "CONVERSATION_NOT_FOUND",
          "Conversation not found.",
          404,
        );
      }
    }
    if (!conversation) {
      [conversation] = await db
        .insert(conversations)
        .values({
          agentId,
          sessionId: input.sessionId,
          externalUserId: input.externalUserId,
          metadata: input.metadata ?? {},
        })
        .returning();
    }
    const attachments = input.attachmentIds.length
      ? await db
          .select()
          .from(messageAttachments)
          .where(
            and(
              inArray(messageAttachments.id, input.attachmentIds),
              eq(messageAttachments.conversationId, conversation.id),
              isNull(messageAttachments.messageId),
            ),
          )
      : [];
    if (attachments.length !== input.attachmentIds.length) {
      throw new AppError(
        "ATTACHMENT_NOT_FOUND",
        "One or more attachments are not available.",
        404,
      );
    }

    const recentMessages = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        citations: messages.citations,
        grounded: messages.grounded,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(desc(messages.createdAt))
      .limit(12);
    const history = recentMessages
      .reverse()
      .filter(
        (message): message is typeof message & {
          role: "user" | "assistant";
        } => message.role === "user" || message.role === "assistant",
      );
    const [userMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: "user",
        content: input.message,
      })
      .returning();
    if (attachments.length) {
      await db
        .update(messageAttachments)
        .set({ messageId: userMessage.id })
        .where(inArray(messageAttachments.id, attachments.map(({ id }) => id)));
    }
    const [ticket] = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(eq(tickets.conversationId, conversation.id))
      .limit(1);
    if (ticket) {
      const now = new Date();
      await Promise.all([
        db
          .update(tickets)
          .set({
            status: "pending",
            lastReplyBy: "visitor",
            resolvedAt: null,
            updatedAt: now,
          })
          .where(eq(tickets.id, ticket.id)),
        db
          .update(conversations)
          .set({
            status: "escalated",
            lastMessageAt: now,
            updatedAt: now,
            title:
              conversation.title ||
              input.message.replace(/\s+/g, " ").slice(0, 90),
          })
          .where(eq(conversations.id, conversation.id)),
      ]);
      return NextResponse.json(
        {
          data: {
            conversationId: conversation.id,
            messageId: userMessage.id,
            answer: "",
            grounded: true,
            confidence: 1,
            citations: [],
            latencyMs: Math.round(performance.now() - startedAt),
            queuedForOperator: true,
          },
          requestId,
        },
        { headers: { "access-control-allow-origin": "*" } },
      );
    }
    let imageAttachments = attachments.filter(
      (attachment) => attachment.kind === "image",
    );
    if (
      !imageAttachments.length &&
      referencesConversationImage(input.message)
    ) {
      const recentMessageIds = recentMessages.map((message) => message.id);
      if (recentMessageIds.length) {
        imageAttachments = await db
          .select()
          .from(messageAttachments)
          .where(
            and(
              eq(messageAttachments.conversationId, conversation.id),
              eq(messageAttachments.kind, "image"),
              isNotNull(messageAttachments.messageId),
              inArray(messageAttachments.messageId, recentMessageIds),
            ),
          )
          .orderBy(desc(messageAttachments.createdAt))
          .limit(1);
      }
    }
    const images = await Promise.all(
      imageAttachments.map(async (attachment) => ({
          mimeType: attachment.mimeType,
          base64: (await readAttachment(attachment.storageKey)).toString(
            "base64",
          ),
        })),
    );
    let visualSearchText = imageAttachments
      .map((attachment) => attachment.metadata?.visualSearchText)
      .find(
        (value): value is string =>
          typeof value === "string" && Boolean(value.trim()),
      );
    if (images.length && !visualSearchText) {
      visualSearchText =
        (await describeImagesForSearch({
          model:
            process.env.VISION_LLM_MODEL?.trim() ||
            agent.modelName ||
            defaultLlmModel(),
          images,
        })) ?? undefined;
      if (visualSearchText) {
        await Promise.all(
          imageAttachments.map((attachment) =>
            db
              .update(messageAttachments)
              .set({
                metadata: {
                  ...(attachment.metadata ?? {}),
                  visualSearchText,
                },
              })
              .where(eq(messageAttachments.id, attachment.id)),
          ),
        );
      }
    }
    const result = await answerQuestion(
      agent,
      input.message,
      history,
      images,
      visualSearchText,
    );
    const latencyMs = Math.round(performance.now() - startedAt);
    const [assistantMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: "assistant",
        content: result.answer,
        citations: result.citations,
        grounded: result.grounded,
        latencyMs,
      })
      .returning();
    await db
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
        title:
          conversation.title ||
          input.message.replace(/\s+/g, " ").slice(0, 90),
      })
      .where(eq(conversations.id, conversation.id));

    return NextResponse.json(
      {
        data: {
          conversationId: conversation.id,
          messageId: assistantMessage.id,
          ...result,
          latencyMs,
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
      "access-control-allow-headers": "content-type",
    },
  });
}
