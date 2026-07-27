import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agents/access";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { actions, agents } from "@/lib/db/schema";
import { errorResponse, readJson } from "@/lib/http/errors";

const schema = z.object({
  agentId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  type: z.enum(["lead_form", "webhook", "link", "human_handoff", "custom_api"]),
  description: z.string().trim().max(500).default(""),
  config: z.record(z.string(), z.unknown()).default({}),
});

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const workspace = await getWorkspaceContext();
    const list = await db.select({ action: actions, agentName: agents.name }).from(actions).innerJoin(agents, eq(agents.id, actions.agentId)).where(eq(agents.workspaceId, workspace.workspaceId)).orderBy(desc(actions.updatedAt));
    return NextResponse.json({ data: list, requestId });
  } catch (error) { return errorResponse(error, requestId); }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const input = schema.parse(await readJson(request));
    await requireAgent(input.agentId);
    const [entry] = await db.insert(actions).values(input).returning();
    return NextResponse.json({ data: entry, requestId }, { status: 201 });
  } catch (error) { return errorResponse(error, requestId); }
}
