import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { agents } from "@/lib/db/schema";
import { AppError, errorResponse } from "@/lib/http/errors";
import {
  createWidgetToken,
  domainAllowed,
  normalizeHost,
} from "@/lib/security/widget-token";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const { agentId } = await context.params;
    const [agent] = await db
      .select({
        id: agents.id,
        name: agents.name,
        status: agents.status,
        welcomeMessage: agents.welcomeMessage,
        fallbackMessage: agents.fallbackMessage,
        primaryColor: agents.primaryColor,
        logoUrl: agents.logoUrl,
        iconUrl: agents.iconUrl,
        widgetPosition: agents.widgetPosition,
        collectFeedback: agents.collectFeedback,
        showCitations: agents.showCitations,
        allowedDomains: agents.allowedDomains,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent || agent.status === "paused") {
      throw new AppError("AGENT_NOT_AVAILABLE", "Agent is not available.", 404);
    }
    const requestingUrl =
      request.headers.get("origin") || request.headers.get("referer") || "";
    const requestingHost = requestingUrl ? normalizeHost(requestingUrl) : "";
    if (
      agent.allowedDomains?.length &&
      (!requestingHost ||
        !domainAllowed(requestingHost, agent.allowedDomains))
    ) {
      throw new AppError(
        "DOMAIN_NOT_ALLOWED",
        "This agent is not allowed on the requesting domain.",
        403,
      );
    }
    const embedToken = await createWidgetToken(
      agent.id,
      requestingHost || "__direct__",
    );
    return NextResponse.json(
      { data: { ...agent, embedToken }, requestId },
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
