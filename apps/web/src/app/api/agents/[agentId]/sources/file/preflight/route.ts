import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agents/access";
import { db } from "@/lib/db/client";
import { sources } from "@/lib/db/schema";
import { errorResponse, readJson } from "@/lib/http/errors";

const schema = z.object({
  fileNames: z.array(z.string().min(1).max(180)).min(1).max(50),
});

type RouteContext = { params: Promise<{ agentId: string }> };

/**
 * Reports which of the chosen file names this agent already has.
 *
 * Re-uploading a name replaces what it indexed before, which is the behaviour
 * people expect but not one they should discover afterwards. The dashboard
 * asks first, the way a desktop file manager does, so replacing is a decision
 * rather than a surprise.
 */
export async function POST(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await context.params;
    await requireAgent(agentId);
    const { fileNames } = schema.parse(await readJson(request));
    const trimmed = fileNames.map((name) => name.slice(0, 180));
    const existing = await db
      .select({ name: sources.name, id: sources.id })
      .from(sources)
      .where(
        and(
          eq(sources.agentId, agentId),
          eq(sources.type, "file"),
          inArray(sources.name, trimmed),
        ),
      );
    return NextResponse.json({
      data: {
        conflicts: existing.map((row) => ({ name: row.name, id: row.id })),
      },
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
