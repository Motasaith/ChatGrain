import { desc, eq } from "drizzle-orm";
import { ActionManager } from "@/components/app/action-manager";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { actions, agents } from "@/lib/db/schema";

export default async function ActionsPage() {
  const workspace = await getWorkspaceContext();
  const agentList = await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.workspaceId, workspace.workspaceId));
  const list = await db
    .select({ id: actions.id, name: actions.name, description: actions.description, type: actions.type, enabled: actions.enabled, agentId: actions.agentId, agentName: agents.name })
    .from(actions)
    .innerJoin(agents, eq(agents.id, actions.agentId))
    .where(eq(agents.workspaceId, workspace.workspaceId))
    .orderBy(desc(actions.updatedAt));
  return <ActionManager agents={agentList} initialActions={list} />;
}
