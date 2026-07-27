import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/agents/access";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";

type Context = {
  params: Promise<{ agentId: string; sourceId: string }>;
};

async function requireSource(agentId: string, sourceId: string) {
  await requireAgent(agentId);
  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.agentId, agentId)))
    .limit(1);
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  return source;
}

export async function POST(_: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId, sourceId } = await context.params;
    await requireSource(agentId, sourceId);
    const [active] = await db
      .select()
      .from(crawlJobs)
      .where(
        and(
          eq(crawlJobs.sourceId, sourceId),
          sql`${crawlJobs.status} in ('queued', 'running')`,
        ),
      )
      .limit(1);
    if (active) {
      return NextResponse.json({ data: active, requestId }, { status: 202 });
    }
    const [job] = await db.transaction(async (tx) => {
      await tx
        .update(sources)
        .set({ status: "pending", errorCode: null, errorMessage: null, updatedAt: new Date() })
        .where(eq(sources.id, sourceId));
      await tx.update(agents).set({ status: "training", updatedAt: new Date() }).where(eq(agents.id, agentId));
      return tx.insert(crawlJobs).values({ sourceId }).returning();
    });
    return NextResponse.json({ data: job, requestId }, { status: 202 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function DELETE(_: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId, sourceId } = await context.params;
    await requireSource(agentId, sourceId);
    await db.delete(sources).where(eq(sources.id, sourceId));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
