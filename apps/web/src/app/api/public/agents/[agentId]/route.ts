import { NextResponse } from "next/server";
import { publicAgentData } from "@/lib/agents/public-agent";
import { errorResponse } from "@/lib/http/errors";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await context.params;
    const agent = await publicAgentData(request, agentId);
    return NextResponse.json(
      { data: agent, requestId },
      {
        headers: {
          "cache-control": "public, max-age=60, stale-while-revalidate=300",
          "access-control-allow-origin": "*",
        },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
