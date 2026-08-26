import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agents/access";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, crawlPages, sources } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { parsePastedUrls } from "@/lib/crawl/pasted-urls";

type Context = {
  params: Promise<{ agentId: string; sourceId: string }>;
};

const schema = z.object({
  /**
   * Extra URLs pasted by the operator, one per line.
   *
   * The case this exists for: a page nothing links to and no sitemap lists,
   * which only the site's owner knows about. Discovery cannot find those by
   * definition, so there has to be a way to say "and this one".
   */
  addUrls: z.string().max(200_000).optional(),
});


/**
 * Approves the reviewed URL list and lets the crawl proceed.
 *
 * The job is put back on the queue rather than started here: the request has no
 * business doing a crawl's work, and the worker is already the thing that owns
 * running jobs. `discoveredAt` stays set, which is how the worker knows to skip
 * straight to fetching rather than discovering all over again.
 */
export async function POST(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId, sourceId } = await context.params;
    await requireAgent(agentId);
    const [source] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.agentId, agentId)))
      .limit(1);
    if (!source) {
      throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
    }

    const body = await request.json().catch(() => ({}));
    const input = schema.parse(body ?? {});

    let added = 0;
    let skipped = 0;
    if (input.addUrls?.trim() && source.rootUrl) {
      const parsed = parsePastedUrls(input.addUrls, source.rootUrl);
      skipped = parsed.skipped;
      for (let offset = 0; offset < parsed.urls.length; offset += 500) {
        const batch = parsed.urls.slice(offset, offset + 500).map((url) => ({
          sourceId,
          url: url.slice(0, 2_000),
          outcome: "discovered",
          // Pasted URLs are selected: someone typed them in on purpose.
          selected: true,
          lastSeenAt: new Date(),
        }));
        const inserted = await db
          .insert(crawlPages)
          .values(batch)
          .onConflictDoUpdate({
            target: [crawlPages.sourceId, crawlPages.url],
            // A URL pasted by hand is an instruction to include it, even if a
            // previous review had turned it off.
            set: { selected: true, lastSeenAt: sql`excluded.last_seen_at` },
          })
          .returning({ url: crawlPages.url });
        added += inserted.length;
      }
    }

    // A crawl already under way is the answer to "start a crawl". Without this
    // check, approving twice started two: the first click ran to completion,
    // the second found nothing awaiting review and queued a fresh job, and the
    // dashboard - still watching the first - showed a finished crawl while the
    // second ran invisibly behind it. Pressing a button twice because nothing
    // appeared to happen is the most ordinary thing a person can do.
    const [inFlight] = await db
      .select({ job: crawlJobs })
      .from(crawlJobs)
      .where(
        and(
          eq(crawlJobs.sourceId, sourceId),
          sql`${crawlJobs.status} in ('queued', 'running')`,
        ),
      )
      .orderBy(sql`${crawlJobs.createdAt} desc`)
      .limit(1);
    if (inFlight) {
      return NextResponse.json(
        {
          data: {
            job: inFlight.job,
            added,
            skipped,
            selected: 0,
            alreadyRunning: true,
          },
          requestId,
        },
        { status: 202 },
      );
    }

    const [waiting] = await db
      .select({ id: crawlJobs.id })
      .from(crawlJobs)
      .where(
        and(
          eq(crawlJobs.sourceId, sourceId),
          eq(crawlJobs.status, "awaiting_review"),
        ),
      )
      .orderBy(sql`${crawlJobs.createdAt} desc`)
      .limit(1);

    const [selected] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(crawlPages)
      .where(
        and(eq(crawlPages.sourceId, sourceId), eq(crawlPages.selected, true)),
      );
    if (!selected?.value) {
      throw new AppError(
        "NOTHING_SELECTED",
        "No pages are selected, so there is nothing to index.",
        400,
      );
    }

    if (!waiting) {
      // Nothing is waiting - the operator is approving a list outside the
      // review flow. Queue a fresh job that skips discovery, since the list
      // they just approved is the list.
      const [job] = await db
        .insert(crawlJobs)
        .values({
          sourceId,
          discoveredAt: new Date(),
          autoApprove: true,
        })
        .returning();
      await db
        .update(agents)
        .set({ status: "training", updatedAt: new Date() })
        .where(eq(agents.id, agentId));
      return NextResponse.json(
        { data: { job, added, skipped, selected: selected.value }, requestId },
        { status: 202 },
      );
    }

    const [job] = await db.transaction(async (tx) => {
      await tx
        .update(sources)
        .set({ status: "pending", updatedAt: new Date() })
        .where(eq(sources.id, sourceId));
      await tx
        .update(agents)
        .set({ status: "training", updatedAt: new Date() })
        .where(eq(agents.id, agentId));
      return tx
        .update(crawlJobs)
        .set({
          status: "queued",
          nextAttemptAt: new Date(),
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(crawlJobs.id, waiting.id))
        .returning();
    });

    return NextResponse.json(
      { data: { job, added, skipped, selected: selected.value }, requestId },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
