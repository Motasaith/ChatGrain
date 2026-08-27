import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminIdentity } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import {
  agents,
  chunks,
  crawlJobs,
  documents,
  sources,
  workspaces,
} from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";

type Context = { params: Promise<{ sourceId: string }> };

const schema = z.object({
  action: z.enum(["reindex"]),
  /**
   * Skip the review step. A re-index started by an administrator on someone
   * else's behalf has nobody waiting to approve a URL list, so the default is
   * to use whatever that source already had selected.
   */
  autoApprove: z.boolean().default(true),
});

async function findSource(sourceId: string) {
  const [source] = await db
    .select({
      id: sources.id,
      name: sources.name,
      agentId: agents.id,
      agentName: agents.name,
      workspaceId: agents.workspaceId,
      workspaceName: workspaces.name,
      suspendedAt: workspaces.suspendedAt,
    })
    .from(sources)
    .innerJoin(agents, eq(agents.id, sources.agentId))
    .innerJoin(workspaces, eq(workspaces.id, agents.workspaceId))
    .where(eq(sources.id, sourceId))
    .limit(1);
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  return source;
}

/**
 * Re-indexing somebody else's source.
 *
 * The case this is for: a corpus that is wrong rather than missing - a crawl
 * that indexed a site's error pages, or one that ran on a build with a fault
 * since fixed. Telling the customer to press the button themselves works, but
 * only if they are available and only if they understand why.
 */
export async function POST(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const { sourceId } = await context.params;
    const input = schema.parse(await request.json());
    const source = await findSource(sourceId);

    // Queuing work for a suspended workspace would sit in the queue until
    // somebody lifted the suspension, which is a confusing way to do nothing.
    if (source.suspendedAt) {
      throw new AppError(
        "WORKSPACE_SUSPENDED",
        `${source.workspaceName} is suspended. Resume it before re-indexing.`,
        409,
      );
    }

    const [active] = await db
      .select({ id: crawlJobs.id })
      .from(crawlJobs)
      .where(
        and(
          eq(crawlJobs.sourceId, sourceId),
          sql`${crawlJobs.status} in ('queued', 'awaiting_review', 'running')`,
        ),
      )
      .limit(1);
    if (active) {
      throw new AppError(
        "JOB_ALREADY_ACTIVE",
        "A crawl is already running for this source.",
        409,
      );
    }

    const [job] = await db
      .insert(crawlJobs)
      .values({
        sourceId,
        autoApprove: input.autoApprove,
        // Discovery is skipped when auto-approving, because the page list this
        // is meant to rebuild from is the one already saved.
        discoveredAt: input.autoApprove ? new Date() : null,
      })
      .returning();

    await recordAudit({
      workspaceId: source.workspaceId,
      actorEmail: identity.email,
      action: "admin.source_reindexed",
      targetType: "source",
      targetId: sourceId,
      message: `Administrator started a re-index of ${source.name} (${source.agentName})`,
      metadata: { autoApprove: input.autoApprove, jobId: job.id },
      requestId,
    });

    return NextResponse.json({ data: { job }, requestId }, { status: 202 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

const deleteSchema = z.object({
  documentIds: z.array(z.uuid()).min(1).max(1_000),
});

/**
 * Removing individual documents from somebody else's index.
 *
 * The narrowest destructive action here, and deliberately so. A crawl that
 * swallowed a few wrong pages - Cloudflare decoys, an error template, a staging
 * page - does not need the source rebuilding, and rebuilding is expensive. The
 * pages are removed and the rest is left alone.
 *
 * Chunks are deleted explicitly rather than left to the cascade: it keeps the
 * intent readable, and it does not depend on the constraint staying that way.
 */
export async function DELETE(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const { sourceId } = await context.params;
    const input = deleteSchema.parse(await request.json());
    const source = await findSource(sourceId);

    const removed = await db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: documents.id, url: documents.canonicalUrl })
        .from(documents)
        .where(
          and(
            eq(documents.sourceId, sourceId),
            inArray(documents.id, input.documentIds),
          ),
        );
      if (!owned.length) return { documents: 0, urls: [] as string[] };
      const ids = owned.map((row) => row.id);
      await tx.delete(chunks).where(inArray(chunks.documentId, ids));
      await tx.delete(documents).where(inArray(documents.id, ids));
      return {
        documents: ids.length,
        urls: owned.map((row) => row.url ?? "").filter(Boolean),
      };
    });

    await recordAudit({
      workspaceId: source.workspaceId,
      actorEmail: identity.email,
      action: "admin.documents_deleted",
      targetType: "source",
      targetId: sourceId,
      message: `Administrator removed ${removed.documents} page(s) from ${source.name}`,
      metadata: { urls: removed.urls.slice(0, 50) },
      requestId,
    });

    return NextResponse.json({ data: removed, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
