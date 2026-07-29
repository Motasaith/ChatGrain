import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import {
  agents,
  conversations,
  messages,
  tickets,
} from "@/lib/db/schema";
import { AppError, errorResponse, readJson } from "@/lib/http/errors";

const schema = z.object({
  status: z.enum(["open", "resolved", "escalated"]),
  operatorMessage: z.string().trim().min(1).max(4_000).optional(),
  ticketStatus: z
    .enum(["open", "pending", "waiting_on_visitor", "resolved", "closed"])
    .optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const [{ conversationId }, workspace, input] = await Promise.all([
      params,
      getWorkspaceContext(),
      readJson(request).then((value) => schema.parse(value)),
    ]);
    const [owned] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(agents, eq(agents.id, conversations.agentId))
      .where(and(eq(conversations.id, conversationId), eq(agents.workspaceId, workspace.workspaceId)))
      .limit(1);
    if (!owned) throw new AppError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
    await db.transaction(async (tx) => {
      const nextConversationStatus = input.operatorMessage
        ? "escalated"
        : input.status;
      await tx
        .update(conversations)
        .set({
          status: nextConversationStatus,
          updatedAt: new Date(),
          ...(input.operatorMessage ? { lastMessageAt: new Date() } : {}),
        })
        .where(eq(conversations.id, conversationId));
      if (input.operatorMessage) {
        await tx.insert(messages).values({ conversationId, role: "operator", content: input.operatorMessage });
      }
      const nextTicketStatus =
        input.ticketStatus ||
        (input.operatorMessage
          ? "waiting_on_visitor"
          : input.status === "resolved"
            ? "resolved"
            : undefined);
      if (nextTicketStatus || input.priority || input.operatorMessage) {
        await tx
          .update(tickets)
          .set({
            ...(nextTicketStatus ? { status: nextTicketStatus } : {}),
            ...(input.priority ? { priority: input.priority } : {}),
            ...(input.operatorMessage ? { lastReplyBy: "operator" } : {}),
            resolvedAt:
              nextTicketStatus === "resolved" ||
              nextTicketStatus === "closed"
                ? new Date()
                : nextTicketStatus
                  ? null
                  : undefined,
            updatedAt: new Date(),
          })
          .where(eq(tickets.conversationId, conversationId));
      }
    });
    return NextResponse.json(
      {
        data: {
          id: conversationId,
          status: input.operatorMessage ? "escalated" : input.status,
        },
        requestId,
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
