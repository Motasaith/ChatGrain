import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { actions, agents, pinnedAnswers } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";
import { copyName } from "@/lib/agents/copy-name";

type RouteContext = { params: Promise<{ agentId: string }> };

/**
 * Columns the copy does not inherit.
 *
 * A list of exclusions rather than a list of inclusions, so a setting added
 * later is copied by default - a copy that quietly diverges from its original
 * because somebody forgot to add a field here would be a strange bug to chase.
 *
 * The cost of that choice is that a *sensitive* column added later would also
 * be copied by default, which is why this list is the place to look. Today the
 * only secret on an agent is `llmApiKeyEncrypted`, and it is deliberately
 * copied: the two agents belong to the same workspace and the same customer,
 * and a copy that silently fell back to the platform's key would answer
 * differently and cost differently from the thing it was copied from. Anything
 * added in future that must not cross - a key belonging to somebody else, a
 * per-agent token - belongs in this list.
 */
const NOT_COPIED = new Set([
  "id",
  "createdAt",
  "updatedAt",
  // Both are set deliberately below.
  "name",
  "status",
]);

/** An agent's settings, ready to be written as a new row. */
function copyableSettings(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).filter(([column]) => !NOT_COPIED.has(column)),
  );
}

/**
 * A child row - a pinned answer, an action - reparented to the copy.
 *
 * Only the identity changes. These carry no name, status or secret of their
 * own, so the agent's exclusion list does not apply to them and using it here
 * would silently drop an action's name.
 */
function reparent(row: Record<string, unknown>, agentId: string) {
  const next: Record<string, unknown> = { ...row, agentId };
  delete next.id;
  return next;
}

/**
 * Copies an agent's configuration into a new one.
 *
 * **Configuration, not knowledge.** The prompt, the appearance, the behaviour
 * settings, the pinned answers and the actions are copied. The sources,
 * documents and chunks are not.
 *
 * That line is the whole design, and it is worth defending. Copying the corpus
 * would mean either duplicating tens of thousands of rows with their embeddings
 * - expensive, and immediately stale - or sharing them, which would make two
 * agents that quietly change together and would surprise whoever deleted one.
 * Re-crawling on the customer's behalf would start a long job they did not ask
 * for. Copying nothing and saying so is the only option that cannot be wrong in
 * a way they notice later.
 *
 * The copy is a draft with no sources, which is the same state a new agent
 * starts in, so the interface that follows already knows how to explain what to
 * do next.
 */
export async function POST(_: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const workspace = await getWorkspaceContext();
    const { agentId } = await context.params;

    const [source] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!source || source.workspaceId !== workspace.workspaceId) {
      throw new AppError("AGENT_NOT_FOUND", "Agent not found.", 404);
    }

    const settings = copyableSettings(source);

    const copy = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(agents)
        .values({
          ...(settings as typeof source),
          name: copyName(source.name),
          // A copy has no indexed pages, so it is not ready to answer anything.
          // Saying "ready" would be a lie the customer would only discover by
          // putting it on their website.
          status: "draft",
        })
        .returning();

      // Both are configuration a person wrote by hand, and both are cheap. An
      // agent copied without its pinned answers would answer differently from
      // the one it was copied from, which is the one thing a copy must not do.
      const pins = await tx
        .select()
        .from(pinnedAnswers)
        .where(eq(pinnedAnswers.agentId, agentId));
      if (pins.length) {
        await tx.insert(pinnedAnswers).values(
          pins.map((pin) => ({
            ...reparent(pin, created.id),
            // Deliberately not carried over: the count belongs to the answers
            // the original actually gave, not to this copy.
            useCount: 0,
          })) as typeof pins,
        );
      }

      const owned = await tx
        .select()
        .from(actions)
        .where(eq(actions.agentId, agentId));
      if (owned.length) {
        await tx.insert(actions).values(
          owned.map((action) => reparent(action, created.id)) as typeof owned,
        );
      }

      return { created, pins: pins.length, actions: owned.length };
    });

    await recordAudit({
      workspaceId: workspace.workspaceId,
      actorEmail: workspace.email,
      action: "agent.duplicated",
      targetType: "agent",
      targetId: copy.created.id,
      message: `Copied ${source.name} to ${copy.created.name}`,
      metadata: {
        from: agentId,
        pinnedAnswers: copy.pins,
        actions: copy.actions,
      },
      requestId,
    });

    return NextResponse.json(
      { data: { agent: copy.created }, requestId },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
