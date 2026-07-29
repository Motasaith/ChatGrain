import { NextResponse } from "next/server";
import { getHomepageAgentId } from "@/lib/agents/homepage-agent";
import { publicAgentData } from "@/lib/agents/public-agent";
import { AppError, errorResponse } from "@/lib/http/errors";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const agentId = await getHomepageAgentId({ usableOnly: true });
    if (!agentId) {
      throw new AppError(
        "SITE_AGENT_PREPARING",
        "Docent support is preparing its website knowledge.",
        503,
      );
    }
    const agent = await publicAgentData(request, agentId);
    return NextResponse.json(
      { data: agent, requestId },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
