import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { actions, agents } from "@/lib/db/schema";
import { AppError, errorResponse, readJson } from "@/lib/http/errors";

const schema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(500), enabled: z.boolean(), config: z.record(z.string(), z.unknown()) }).partial();

async function requireAction(actionId: string) {
  const workspace = await getWorkspaceContext();
  const [entry] = await db.select({ id: actions.id }).from(actions).innerJoin(agents, eq(agents.id, actions.agentId)).where(and(eq(actions.id, actionId), eq(agents.workspaceId, workspace.workspaceId))).limit(1);
  if (!entry) throw new AppError("ACTION_NOT_FOUND", "Action not found.", 404);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { actionId } = await params;
    await requireAction(actionId);
    const input = schema.parse(await readJson(request));
    const [entry] = await db.update(actions).set({ ...input, updatedAt: new Date() }).where(eq(actions.id, actionId)).returning();
    return NextResponse.json({ data: entry, requestId });
  } catch (error) { return errorResponse(error, requestId); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ actionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { actionId } = await params;
    await requireAction(actionId);
    await db.delete(actions).where(eq(actions.id, actionId));
    return new NextResponse(null, { status: 204 });
  } catch (error) { return errorResponse(error, requestId); }
}
