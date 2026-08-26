import { and, asc, desc, eq, inArray, ilike, ne, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agents/access";
import { db } from "@/lib/db/client";
import { chunks, crawlPages, documents, sources } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { likePattern } from "@/lib/search/like";

type Context = {
  params: Promise<{ agentId: string; sourceId: string }>;
};

/**
 * Large enough to scroll through a site, small enough that one request stays
 * cheap on a 10,000-page source.
 */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

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

const SORTS = {
  sequence: crawlPages.sequence,
  url: crawlPages.url,
  title: crawlPages.title,
  firstSeen: crawlPages.firstSeenAt,
  lastSeen: crawlPages.lastSeenAt,
} as const;

type SortKey = keyof typeof SORTS;

/**
 * The page inventory for one source.
 *
 * Filtering, sorting and counting all happen in the database rather than by
 * fetching everything and narrowing in the client: a source can hold thousands
 * of URLs, and "show me the twenty that failed" should not transfer the other
 * nine thousand nine hundred and eighty.
 */
export async function GET(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId, sourceId } = await context.params;
    await requireSource(agentId, sourceId);

    const params = new URL(request.url).searchParams;
    const query = params.get("q")?.trim() ?? "";
    const outcome = params.get("outcome")?.trim() ?? "";
    const selection = params.get("selected")?.trim() ?? "all";
    const sortKey = (params.get("sort") ?? "sequence") as SortKey;
    const column = SORTS[sortKey] ?? SORTS.sequence;
    const direction = params.get("order") === "asc" ? asc : desc;
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(params.get("pageSize")) || DEFAULT_PAGE_SIZE),
    );
    const page = Math.max(1, Number(params.get("page")) || 1);

    const filters = [eq(crawlPages.sourceId, sourceId)];
    if (query) {
      const like = likePattern(query);
      filters.push(
        or(ilike(crawlPages.url, like), ilike(crawlPages.title, like))!,
      );
    }
    if (outcome && outcome !== "all") {
      filters.push(eq(crawlPages.outcome, outcome));
    } else {
      // Suggestions are a separate list, not part of "all". They are URLs the
      // crawler noticed in passing that nobody has reviewed, and folding them
      // into the page list would undo the point of having reviewed it.
      filters.push(ne(crawlPages.outcome, "suggested"));
    }
    if (selection === "included") filters.push(eq(crawlPages.selected, true));
    if (selection === "excluded") filters.push(eq(crawlPages.selected, false));
    const where = and(...filters);

    const [rows, totals, byOutcome] = await Promise.all([
      db
        .select({
          id: crawlPages.id,
          url: crawlPages.url,
          title: crawlPages.title,
          outcome: crawlPages.outcome,
          reason: crawlPages.reason,
          chunkCount: crawlPages.chunkCount,
          selected: crawlPages.selected,
          firstSeenAt: crawlPages.firstSeenAt,
          lastSeenAt: crawlPages.lastSeenAt,
        })
        .from(crawlPages)
        .where(where)
        .orderBy(direction(column))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(crawlPages)
        .where(where),
      // Counts for the whole source, not the current filter: they are the
      // filter's own tab labels, so narrowing to "failed" must not report that
      // there is nothing else.
      db
        .select({
          outcome: crawlPages.outcome,
          count: sql<number>`count(*)::int`,
        })
        .from(crawlPages)
        .where(eq(crawlPages.sourceId, sourceId))
        .groupBy(crawlPages.outcome),
    ]);

    const total = totals[0]?.value ?? 0;
    const outcomeCounts = Object.fromEntries(
      byOutcome.map((row) => [row.outcome, row.count]),
    );
    // Reported on its own so the interface can offer it as a separate list
    // rather than a filter over the reviewed one.
    const suggested = outcomeCounts.suggested ?? 0;
    delete outcomeCounts.suggested;
    return NextResponse.json({
      data: {
        pages: rows,
        total,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
        outcomes: outcomeCounts,
        suggested,
      },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

const patchSchema = z.object({
  selected: z.boolean(),
  /** Specific URLs, or every URL matching the current filter. */
  urls: z.array(z.string()).max(5_000).optional(),
  all: z.boolean().optional(),
  outcome: z.string().optional(),
  q: z.string().optional(),
});

/**
 * Includes or excludes pages.
 *
 * Excluding is not deleting: the row stays, so the operator can see what they
 * turned off and turn it back on. The crawler reads this and skips the URL,
 * and because a crawl upserts without touching `selected`, the decision
 * survives every future run.
 */
export async function PATCH(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId, sourceId } = await context.params;
    await requireSource(agentId, sourceId);
    const input = patchSchema.parse(await request.json());

    const filters = [eq(crawlPages.sourceId, sourceId)];
    if (input.all) {
      if (input.q) {
        const like = likePattern(input.q);
        filters.push(
          or(ilike(crawlPages.url, like), ilike(crawlPages.title, like))!,
        );
      }
      if (input.outcome && input.outcome !== "all") {
        filters.push(eq(crawlPages.outcome, input.outcome));
      }
    } else {
      if (!input.urls?.length) {
        throw new AppError("NO_PAGES", "No pages were selected.", 400);
      }
      filters.push(inArray(crawlPages.url, input.urls));
    }

    const updated = await db
      .update(crawlPages)
      .set({
        selected: input.selected,
        // Accepting a suggestion promotes it out of the suggestions list. It
        // has been looked at now, which is the only thing that separated the
        // two lists in the first place; leaving it behind would mean the
        // operator keeps being shown a decision they have already made.
        outcome: input.selected
          ? sql`case when ${crawlPages.outcome} = 'suggested' then 'discovered' else ${crawlPages.outcome} end`
          : sql`${crawlPages.outcome}`,
      })
      .where(and(...filters))
      .returning({ url: crawlPages.url });

    return NextResponse.json({
      data: { updated: updated.length, selected: input.selected },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

const deleteSchema = z.object({
  urls: z.array(z.string()).min(1).max(5_000),
});

/**
 * Removes pages from the inventory and from the index.
 *
 * Both, deliberately. Dropping the inventory row alone would leave the page
 * answerable while showing nothing in the list to explain why, and dropping
 * the document alone would leave a row the next crawl treats as known.
 *
 * A deleted URL is not excluded, so a later crawl may find it again. That is
 * the intended difference: delete is "this is wrong, forget it", exclude is
 * "never fetch this".
 */
export async function DELETE(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId, sourceId } = await context.params;
    await requireSource(agentId, sourceId);
    const input = deleteSchema.parse(await request.json());

    const removed = await db.transaction(async (tx) => {
      const targets = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.sourceId, sourceId),
            inArray(documents.canonicalUrl, input.urls),
          ),
        );
      if (targets.length) {
        const ids = targets.map((row) => row.id);
        // Chunks cascade from documents, but deleting them explicitly keeps
        // this readable and does not depend on the constraint staying that way.
        await tx.delete(chunks).where(inArray(chunks.documentId, ids));
        await tx.delete(documents).where(inArray(documents.id, ids));
      }
      const pages = await tx
        .delete(crawlPages)
        .where(
          and(
            eq(crawlPages.sourceId, sourceId),
            inArray(crawlPages.url, input.urls),
          ),
        )
        .returning({ url: crawlPages.url });
      return { pages: pages.length, documents: targets.length };
    });

    return NextResponse.json({ data: removed, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
