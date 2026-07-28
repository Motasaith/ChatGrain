import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { errorResponse, readJson } from "@/lib/http/errors";
import { recordAudit } from "@/lib/observability/audit";

const schema = z.object({ name: z.string().trim().min(2).max(80) });

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const [context, input] = await Promise.all([getWorkspaceContext(), readJson(request).then((value) => schema.parse(value))]);
    const [workspace] = await db.update(workspaces).set({ name: input.name, updatedAt: new Date() }).where(eq(workspaces.id, context.workspaceId)).returning();
    await recordAudit({
      workspaceId: context.workspaceId,
      actorUserId: context.userId,
      actorEmail: context.email,
      action: "workspace.updated",
      targetType: "workspace",
      targetId: context.workspaceId,
      message: `Renamed workspace to "${input.name}".`,
      requestId,
    });
    return NextResponse.json({ data: workspace, requestId });
  } catch (error) { return errorResponse(error, requestId); }
}
