import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { agents, conversations, leads } from "@/lib/db/schema";
import { AppError, errorResponse, readJson } from "@/lib/http/errors";
import { rateLimit } from "@/lib/http/rate-limit";

const schema = z.object({
  agentId: z.uuid(),
  conversationId: z.uuid().optional(),
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
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, input.agentId))
      .limit(1);
    if (!agent) throw new AppError("AGENT_NOT_FOUND", "Agent not found.", 404);
    if (input.conversationId) {
      const [conversation] = await db
        .select({ agentId: conversations.agentId })
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .limit(1);
      if (!conversation || conversation.agentId !== agent.id) {
        throw new AppError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
      }
    }
    const [lead] = await db.insert(leads).values(input).returning();
    return NextResponse.json({ data: lead, requestId }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
