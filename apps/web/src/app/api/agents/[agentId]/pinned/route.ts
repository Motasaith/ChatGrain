import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agents/access";
import { db } from "@/lib/db/client";
import { pinnedAnswers } from "@/lib/db/schema";
import { errorResponse, readJson } from "@/lib/http/errors";

const schema = z.object({
  title: z.string().trim().min(2).max(160),
  questions: z.array(z.string().trim().min(3).max(500)).min(1).max(20),
  answer: z.string().trim().min(2).max(8_000),
});

export async function GET(
  _: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await params;
    await requireAgent(agentId);
    const list = await db
      .select()
      .from(pinnedAnswers)
      .where(eq(pinnedAnswers.agentId, agentId))
      .orderBy(desc(pinnedAnswers.updatedAt));
    return NextResponse.json({ data: list, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await params;
    await requireAgent(agentId);
    const input = schema.parse(await readJson(request));
    const [entry] = await db
      .insert(pinnedAnswers)
      .values({ agentId, ...input })
      .returning();
    return NextResponse.json({ data: entry, requestId }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
