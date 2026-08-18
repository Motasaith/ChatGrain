import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agents/access";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources } from "@/lib/db/schema";
import { AppError, errorResponse, readJson } from "@/lib/http/errors";

const schema = z.object({
  sourceIds: z.array(z.string().uuid()).min(1).max(50),
});

type RouteContext = { params: Promise<{ agentId: string }> };

/**
 * Queues another attempt for sources that failed.
 *
 * Scoped to the ones named rather than the whole upload: re-running twenty
 * files because one of them was a scanned PDF would spend the slowest part of
 * the pipeline redoing work that already succeeded.
 */
export async function POST(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await context.params;
    await requireAgent(agentId);
    const { sourceIds } = schema.parse(await readJson(request));

    const batchId = crypto.randomUUID();
    const queued = await db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: sources.id })
        .from(sources)
        .where(
          and(eq(sources.agentId, agentId), inArray(sources.id, sourceIds)),
        );
      if (!owned.length) {
        throw new AppError(
          "SOURCE_NOT_FOUND",
          "Those sources are no longer available.",
          404,
        );
      }
      await tx
        .update(sources)
        .set({
          status: "pending",
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(
          inArray(
            sources.id,
            owned.map((source) => source.id),
          ),
        );
      return tx
        .insert(crawlJobs)
        .values(
          owned.map((source) => ({ sourceId: source.id, batchId })),
        )
        .returning({ id: crawlJobs.id, sourceId: crawlJobs.sourceId });
    });

    await db
      .update(agents)
      .set({ status: "training", updatedAt: new Date() })
      .where(eq(agents.id, agentId));

    return NextResponse.json(
      { data: { batchId, jobs: queued }, requestId },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
