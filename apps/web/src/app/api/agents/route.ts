import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, crawlJobs, sources } from "@/lib/db/schema";
import { errorResponse, readJson } from "@/lib/http/errors";
import { defaultLlmModel } from "@/lib/llm/client";
import { validatePublicUrl } from "@/lib/security/public-url";

const createAgentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(""),
  websiteUrl: z.url().optional(),
  pageLimit: z.number().int().min(1).max(500).default(100),
});

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const context = await getWorkspaceContext();
    const list = await db
      .select()
      .from(agents)
      .where(eq(agents.workspaceId, context.workspaceId))
      .orderBy(desc(agents.updatedAt));
    return NextResponse.json({ data: list, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const input = createAgentSchema.parse(await readJson(request));
    const websiteUrl = input.websiteUrl
      ? await validatePublicUrl(input.websiteUrl)
      : null;
    const context = await getWorkspaceContext();
    const result = await db.transaction(async (tx) => {
      const [agent] = await tx
        .insert(agents)
        .values({
          workspaceId: context.workspaceId,
          name: input.name,
          description: input.description,
          status: websiteUrl ? "training" : "draft",
          systemPrompt:
            "Answer as a helpful customer support agent. Use only verified knowledge sources and be concise.",
          modelProvider: "ollama",
          modelName: defaultLlmModel(),
        })
        .returning();
      if (!websiteUrl) return { agent, source: null, job: null };

      const root = websiteUrl;
      root.hash = "";
      const [source] = await tx
        .insert(sources)
        .values({
          agentId: agent.id,
          type: "website",
          name: root.hostname.replace(/^www\./, ""),
          rootUrl: root.href,
          pageLimit: input.pageLimit,
          status: "pending",
        })
        .returning();
      const [job] = await tx
        .insert(crawlJobs)
        .values({ sourceId: source.id })
        .returning();
      return { agent, source, job };
    });
    return NextResponse.json(
      { data: result, requestId },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
