import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agents/access";
import { db } from "@/lib/db/client";
import { agents, sources } from "@/lib/db/schema";
import { AppError, errorResponse, readJson } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";

const updateAgentSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500),
    systemPrompt: z.string().trim().max(8_000),
    welcomeMessage: z.string().trim().min(1).max(1_000),
    fallbackMessage: z.string().trim().min(1).max(1_000),
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    logoUrl: z.url().nullable(),
    iconUrl: z.url().nullable(),
    widgetPosition: z.enum(["left", "right"]),
    teaserMessages: z.array(z.string().trim().min(1).max(160)).max(3),
    attentionMessage: z.string().trim().max(80),
    suggestedQuestions: z
      .array(z.string().trim().min(1).max(120))
      .max(4),
    helpCenterEnabled: z.boolean(),
    helpCenterGreeting: z.string().trim().min(1).max(160),
    showBranding: z.boolean(),
    collectFeedback: z.boolean(),
    followUpSuggestions: z.boolean(),
    businessHours: z
      .object({
        timezone: z.string().trim().min(1).max(60),
        days: z
          .array(
            z.array(
              z.object({
                start: z.number().int().min(0).max(1_440),
                end: z.number().int().min(0).max(1_440),
              }),
            ),
          )
          .length(7),
      })
      .nullable(),
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
    const { context: workspace } = await requireAgent(agentId);
    const input = updateAgentSchema.parse(await readJson(request));
    if (input.showBranding !== undefined && !workspace.isAdmin) {
      throw new AppError(
        "ADMIN_REQUIRED",
        "Only a ChatGrain administrator can change widget branding.",
        403,
      );
    }
    const [agent] = await db
      .update(agents)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(agents.id, agentId))
      .returning();
    await recordAudit({
      workspaceId: workspace.workspaceId,
      actorUserId: workspace.userId,
      actorEmail: workspace.email,
      action: "agent.updated",
      targetType: "agent",
      targetId: agentId,
      message: `Updated agent "${agent.name}".`,
      metadata: { fields: Object.keys(input) },
      requestId,
    });
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
    const [deleted] = await db
      .delete(agents)
      .where(
        and(
          eq(agents.id, agentId),
          eq(agents.workspaceId, workspace.workspaceId),
        ),
      )
      .returning({ name: agents.name });
    await recordAudit({
      workspaceId: workspace.workspaceId,
      actorUserId: workspace.userId,
      actorEmail: workspace.email,
      action: "agent.deleted",
      targetType: "agent",
      targetId: agentId,
      message: `Deleted agent "${deleted?.name ?? agentId}".`,
      requestId,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
