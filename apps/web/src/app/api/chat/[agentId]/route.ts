import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { answerQuestion } from "@/lib/chat/answer";
import { db } from "@/lib/db/client";
import { agents, conversations, messages } from "@/lib/db/schema";
import { AppError, errorResponse, readJson } from "@/lib/http/errors";
import { rateLimit } from "@/lib/http/rate-limit";
import {
  domainAllowed,
  verifyWidgetToken,
} from "@/lib/security/widget-token";

const chatSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  sessionId: z.string().trim().min(8).max(200),
  conversationId: z.uuid().optional(),
  externalUserId: z.string().trim().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  embedToken: z.string().max(2_000).optional(),
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
          ),
        )
        .limit(1);
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

    await db.insert(messages).values({
      conversationId: conversation.id,
      role: "user",
      content: input.message,
    });
    const result = await answerQuestion(agent, input.message);
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
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
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
