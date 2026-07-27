import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/agents/access";
import { db } from "@/lib/db/client";
import { pinnedAnswers } from "@/lib/db/schema";
import { errorResponse } from "@/lib/http/errors";

export async function DELETE(
  _: Request,
  {
    params,
  }: {
    params: Promise<{ agentId: string; pinnedId: string }>;
  },
) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId, pinnedId } = await params;
    await requireAgent(agentId);
    await db
      .delete(pinnedAnswers)
      .where(
        and(
          eq(pinnedAnswers.id, pinnedId),
          eq(pinnedAnswers.agentId, agentId),
        ),
      );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
