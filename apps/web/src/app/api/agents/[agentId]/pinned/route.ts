import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { embedTexts } from "@/lib/rag/embeddings";
import { logger } from "@/lib/observability/logger";
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

    /**
     * Embedded now, so matching later can be about meaning rather than
     * spelling.
     *
     * Failure is tolerated on purpose. An embedding provider that is down or
     * misconfigured must not stop somebody saving a pinned answer - the pin
     * still works, matched on words exactly as it did before this existed, and
     * the vectors can be filled in on the next save.
     */
    let questionVectors: number[][] | null = null;
    try {
      questionVectors = await embedTexts(input.questions, "query");
    } catch (error) {
      logger.warn({ error, agentId }, "Pinned answer saved without vectors");
    }

    const [entry] = await db
      .insert(pinnedAnswers)
      .values({ agentId, ...input, questionVectors })
      .returning();
    return NextResponse.json({ data: entry, requestId }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
