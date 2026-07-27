import "server-only";

import { and, eq } from "drizzle-orm";
import { AppError } from "@/lib/http/errors";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents } from "@/lib/db/schema";

export async function requireAgent(agentId: string) {
  const context = await getWorkspaceContext();
  const [agent] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.workspaceId, context.workspaceId),
      ),
    )
    .limit(1);
  if (!agent) {
    throw new AppError("AGENT_NOT_FOUND", "Agent not found.", 404);
  }
  return { agent, context };
}
