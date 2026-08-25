import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agents/access";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { discardStagedUpload } from "@/lib/sources/upload-store";

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

/**
 * How often this source re-crawls itself, in hours. Null means never.
 *
 * The column and the scheduler that reads it have both existed since 0.2, but
 * nothing in the interface ever set it: the value was fixed at creation and
 * could not be changed afterwards, which made a weekly default a permanent
 * one. `nextSyncAt` is recomputed here rather than left alone, because the
 * scheduler reads that and not the interval - without it, switching from
 * monthly to daily would still wait out the month.
 */
const settingsSchema = z.object({
  refreshIntervalHours: z.number().int().min(1).max(8_760).nullable(),
});

export async function PATCH(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId, sourceId } = await context.params;
    await requireSource(agentId, sourceId);
    const input = settingsSchema.parse(await request.json());
    const [updated] = await db
      .update(sources)
      .set({
        refreshIntervalHours: input.refreshIntervalHours,
        nextSyncAt: input.refreshIntervalHours
          ? new Date(Date.now() + input.refreshIntervalHours * 60 * 60 * 1000)
          : null,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, sourceId))
      .returning();
    return NextResponse.json({ data: updated, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function DELETE(_: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId, sourceId } = await context.params;
    const existing = await requireSource(agentId, sourceId);
    await db.delete(sources).where(eq(sources.id, sourceId));
    // A staged upload outlives its job when that job failed, so that a retry
    // does not need the file again. Deleting the source is the point at which
    // nothing will ever read it, and leaving it would leak storage silently.
    const staged = (existing.metadata?.upload as { storageKey?: string } | undefined)
      ?.storageKey;
    if (staged) await discardStagedUpload(staged);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
