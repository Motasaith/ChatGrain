import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agents/access";
import { db } from "@/lib/db/client";
import { agents, sources } from "@/lib/db/schema";
import { errorResponse, readJson } from "@/lib/http/errors";

const updateAgentSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500),
    systemPrompt: z.string().trim().max(8_000),
    welcomeMessage: z.string().trim().min(1).max(1_000),
    fallbackMessage: z.string().trim().min(1).max(1_000),
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    logoUrl: z.url().nullable(),
    widgetPosition: z.enum(["left", "right"]),
    collectFeedback: z.boolean(),
    showCitations: z.boolean(),
    strictMode: z.boolean(),
    allowedDomains: z.array(z.string().trim().min(1).max(255)).max(100),
    modelProvider: z.enum(["extractive", "ollama"]),
    modelName: z.string().trim().max(120).nullable(),
    temperature: z.number().min(0).max(1),
  })
  .partial();

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(_: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await context.params;
    const { agent } = await requireAgent(agentId);
    const sourceList = await db
      .select()
      .from(sources)
      .where(eq(sources.agentId, agentId));
    return NextResponse.json({
      data: { ...agent, sources: sourceList },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await context.params;
    await requireAgent(agentId);
    const input = updateAgentSchema.parse(await readJson(request));
    const [agent] = await db
      .update(agents)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(agents.id, agentId))
      .returning();
    return NextResponse.json({ data: agent, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await context.params;
    const { context: workspace } = await requireAgent(agentId);
    await db
      .delete(agents)
      .where(
        and(
          eq(agents.id, agentId),
          eq(agents.workspaceId, workspace.workspaceId),
        ),
      );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
