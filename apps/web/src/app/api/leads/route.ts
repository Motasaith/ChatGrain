import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  agents,
  conversations,
  events,
  leads,
  messages,
} from "@/lib/db/schema";
import { AppError, errorResponse, readJson } from "@/lib/http/errors";
import { rateLimit } from "@/lib/http/rate-limit";
import {
  domainAllowed,
  verifyWidgetToken,
} from "@/lib/security/widget-token";

const schema = z.object({
  agentId: z.uuid(),
  conversationId: z.uuid().optional(),
  sessionId: z.string().trim().min(8).max(200).optional(),
  embedToken: z.string().max(2_000).optional(),
  name: z.string().trim().max(120).optional(),
  email: z.email().optional(),
  phone: z.string().trim().max(40).optional(),
  data: z.record(z.string(), z.unknown()).default({}),
}).refine((value) => value.email || value.phone, {
  message: "An email or phone number is required.",
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    rateLimit(`lead:${request.headers.get("x-forwarded-for") || "local"}`, 10, 60_000);
    const input = schema.parse(await readJson(request, 30_000));
    const [agent] = await db
      .select({
        id: agents.id,
        workspaceId: agents.workspaceId,
        allowedDomains: agents.allowedDomains,
      })
      .from(agents)
      .where(eq(agents.id, input.agentId))
      .limit(1);
    if (!agent) throw new AppError("AGENT_NOT_FOUND", "Agent not found.", 404);
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
    if (input.conversationId) {
      const [conversation] = await db
        .select({
          agentId: conversations.agentId,
          sessionId: conversations.sessionId,
        })
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .limit(1);
      if (
        !conversation ||
        conversation.agentId !== agent.id ||
        !input.sessionId ||
        conversation.sessionId !== input.sessionId
      ) {
        throw new AppError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
      }
    }
    const [lead] = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(leads)
        .values({
          agentId: input.agentId,
          conversationId: input.conversationId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          data: input.data,
        })
        .returning();
      if (input.conversationId) {
        await tx
          .update(conversations)
          .set({
            status: "escalated",
            visitorName: input.name || null,
            visitorEmail: input.email || null,
            topic: "Human follow-up requested",
            lastMessageAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, input.conversationId));
        await tx.insert(messages).values({
          conversationId: input.conversationId,
          role: "system",
          content:
            "The visitor submitted a request for human follow-up.",
          grounded: true,
        });
      }
      await tx.insert(events).values({
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        type: "handoff.requested",
        properties: {
          leadId: inserted[0].id,
          conversationId: input.conversationId ?? null,
          hasEmail: Boolean(input.email),
          hasPhone: Boolean(input.phone),
        },
      });
      return inserted;
    });
    return NextResponse.json({ data: lead, requestId }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
