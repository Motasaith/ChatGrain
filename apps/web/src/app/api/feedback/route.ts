import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { feedback, messages } from "@/lib/db/schema";
import { AppError, errorResponse, readJson } from "@/lib/http/errors";
import { rateLimit } from "@/lib/http/rate-limit";

const schema = z.object({
  messageId: z.uuid(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().trim().max(1_000).optional(),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    rateLimit(`feedback:${request.headers.get("x-forwarded-for") || "local"}`, 60, 60_000);
    const input = schema.parse(await readJson(request, 20_000));
    const [message] = await db
      .select({ id: messages.id, role: messages.role })
      .from(messages)
      .where(eq(messages.id, input.messageId))
      .limit(1);
    if (!message || message.role !== "assistant") {
      throw new AppError("MESSAGE_NOT_FOUND", "Message not found.", 404);
    }
    const [entry] = await db
      .insert(feedback)
      .values(input)
      .onConflictDoUpdate({
        target: feedback.messageId,
        set: { rating: input.rating, comment: input.comment },
      })
      .returning();
    return NextResponse.json({ data: entry, requestId }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
