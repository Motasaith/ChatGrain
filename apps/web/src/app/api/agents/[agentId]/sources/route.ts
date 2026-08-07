import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agents/access";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources } from "@/lib/db/schema";
import { errorResponse, readJson } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";
import { validatePublicUrl } from "@/lib/security/public-url";
import { enforceCrawlPageLimit } from "@/lib/usage/limits";

const websiteSourceSchema = z.object({
  type: z.literal("website"),
  url: z.string().min(1),
  pageLimit: z.number().int().min(1).max(2_147_483_647).default(10_000),
  includePaths: z.array(z.string().startsWith("/")).max(50).default([]),
  excludePaths: z.array(z.string().startsWith("/")).max(50).default([]),
  refreshIntervalHours: z.number().int().min(1).max(8_760).nullable().default(168),
});

type RouteContext = { params: Promise<{ agentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await context.params;
    const { context: workspace } = await requireAgent(agentId);
    const input = websiteSourceSchema.parse(await readJson(request));
    const pageLimit = enforceCrawlPageLimit(
      input.pageLimit,
      workspace.isAdmin,
    );
    const url = await validatePublicUrl(input.url);
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(sources)
        .where(
          and(eq(sources.agentId, agentId), eq(sources.rootUrl, url.href)),
        )
        .limit(1);
      const values = {
        pageLimit,
        includePaths: input.includePaths,
        excludePaths: input.excludePaths,
        refreshIntervalHours: input.refreshIntervalHours,
        status: "pending" as const,
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
      };
      const [source] = existing
        ? await tx
            .update(sources)
            .set(values)
            .where(eq(sources.id, existing.id))
            .returning()
        : await tx.insert(sources).values({
          agentId,
          type: "website",
          name: url.hostname.replace(/^www\./, ""),
          rootUrl: url.href,
          ...values,
        }).returning();
      const [job] = await tx
        .insert(crawlJobs)
        .values({ sourceId: source.id })
        .returning();
      await tx
        .update(agents)
        .set({ status: "training", updatedAt: new Date() })
        .where(eq(agents.id, agentId));
      return { source, job };
    });
    await recordAudit({
      workspaceId: workspace.workspaceId,
      actorUserId: workspace.userId,
      actorEmail: workspace.email,
      action: "source.training_queued",
      targetType: "source",
      targetId: result.source.id,
      message: `Queued training for ${url.hostname}.`,
      metadata: { url: url.href, jobId: result.job.id },
      requestId,
    });
    return NextResponse.json(
      { data: result, requestId },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
