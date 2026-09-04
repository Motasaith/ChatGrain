import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, documents, sources } from "@/lib/db/schema";

/** Job states that mean work is still outstanding for this agent. */
const OUTSTANDING = ["queued", "awaiting_review", "running"] as const;

/**
 * Works out what an agent's status should be, from what actually exists.
 *
 * Status was only ever *pushed* - set to "training" when a crawl started, set
 * to "ready" when one finished - which works until something ends a job by a
 * route nobody thought of. Deleting a source was exactly that route: the source
 * row went, its crawl job went with it through the cascade, and the agent was
 * left saying "training" with nothing training it. Nothing would ever move it
 * again, because the only thing that moved it was a job completing and there
 * was no longer a job.
 *
 * So this derives the answer instead of remembering it:
 *
 * - **training** if any job is queued, awaiting review, or running.
 * - **ready** if the agent has indexed documents to answer from.
 * - **draft** otherwise - no work outstanding and nothing to answer with, which
 *   is the same state a new agent starts in and the same thing the interface
 *   already knows how to explain.
 *
 * Two states are deliberately never assigned here. **paused** is somebody's
 * decision and outlives any crawl, so recomputing over it would silently
 * restart an agent an administrator had stopped. **error** describes a specific
 * failure with a message attached, and is set by whatever discovered it.
 */
export async function recomputeAgentStatus(agentId: string) {
  const [agent] = await db
    .select({ status: agents.status })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return null;
  if (agent.status === "paused" || agent.status === "error") return agent.status;

  const [outstanding] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(crawlJobs)
    .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
    .where(
      and(
        eq(sources.agentId, agentId),
        inArray(crawlJobs.status, [...OUTSTANDING]),
      ),
    );

  let next: "training" | "ready" | "draft";
  if (outstanding?.value) {
    next = "training";
  } else {
    const [indexed] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(documents)
      .innerJoin(sources, eq(sources.id, documents.sourceId))
      .where(eq(sources.agentId, agentId));
    next = indexed?.value ? "ready" : "draft";
  }

  if (next === agent.status) return agent.status;
  await db
    .update(agents)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(agents.id, agentId));
  return next;
}
