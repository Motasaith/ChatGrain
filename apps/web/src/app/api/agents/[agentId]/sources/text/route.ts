import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agents/access";
import { errorResponse, readJson } from "@/lib/http/errors";
import { ingestTextSource } from "@/lib/sources/ingest-text";

const schema = z.object({
  name: z.string().trim().min(2).max(160),
  content: z.string().trim().min(80).max(2_000_000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await params;
    await requireAgent(agentId);
    const input = schema.parse(await readJson(request, 2_100_000));
    const result = await ingestTextSource({ agentId, ...input });
    return NextResponse.json({ data: result, requestId }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
