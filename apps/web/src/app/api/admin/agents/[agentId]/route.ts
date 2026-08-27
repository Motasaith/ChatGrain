import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminIdentity } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources, workspaces } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { cancelJobs } from "@/lib/jobs/cancel-jobs";
import { recordAudit } from "@/lib/observability/audit";

type Context = { params: Promise<{ agentId: string }> };

/**
 * Pausing one agent, without touching the rest of its workspace.
 *
 * Suspending a workspace is the blunt instrument; this is the precise one. An
 * agent answering badly - a poisoned corpus, a prompt someone broke - should be
 * stoppable on its own, and the alternative today is to stop the customer's
 * whole account or to ask them nicely.
 */
const schema = z.object({
  status: z.enum(["paused", "ready"]),
  reason: z.string().max(500).optional(),
});

export async function PATCH(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireAdminIdentity();
    const { agentId } = await context.params;
    const input = schema.parse(await request.json());

    const [agent] = await db
      .select({
        id: agents.id,
        name: agents.name,
        status: agents.status,
        workspaceId: agents.workspaceId,
        workspaceName: workspaces.name,
      })
      .from(agents)
      .innerJoin(workspaces, eq(workspaces.id, agents.workspaceId))
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent) throw new AppError("AGENT_NOT_FOUND", "Agent not found.", 404);

    const [updated] = await db
      .update(agents)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(agents.id, agentId))
      .returning();

    // A paused agent that is still crawling is not paused in the way anyone
    // means it. Queued work is left alone so that resuming picks it back up.
    let stopped = 0;
    if (input.status === "paused") {
      const running = await db
        .select({ id: crawlJobs.id })
        .from(crawlJobs)
        .innerJoin(sources, eq(sources.id, crawlJobs.sourceId))
        .where(
          and(eq(sources.agentId, agentId), eq(crawlJobs.status, "running")),
        );
      if (running.length) {
        await cancelJobs(running.map((job) => job.id));
        stopped = running.length;
      }
    }

    await recordAudit({
      workspaceId: agent.workspaceId,
      actorEmail: identity.email,
      action:
        input.status === "paused" ? "admin.agent_paused" : "admin.agent_resumed",
      targetType: "agent",
      targetId: agentId,
      message:
        input.status === "paused"
          ? `Administrator paused ${agent.name}${stopped ? `, stopping ${stopped} running crawl(s)` : ""}`
          : `Administrator resumed ${agent.name}`,
      metadata: {
        from: agent.status,
        reason: input.reason ?? null,
        stoppedJobs: stopped,
      },
      requestId,
    });

    return NextResponse.json({
      data: { agent: updated, stoppedJobs: stopped },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/**
 * What this agent knows, for deciding whether something needs removing.
 *
 * Read before acting rather than reported after, on the same reasoning as the
 * workspace delete preview: "are you sure" is not answerable without numbers.
 */
export async function GET(_: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    await requireAdminIdentity();
    const { agentId } = await context.params;
    const rows = await db
      .select({
        id: sources.id,
        name: sources.name,
        status: sources.status,
        rootUrl: sources.rootUrl,
        documents: sql<number>`(
          select count(*)::int from documents where documents.source_id = ${sources.id}
        )`,
      })
      .from(sources)
      .where(eq(sources.agentId, agentId));
    return NextResponse.json({ data: { sources: rows }, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
