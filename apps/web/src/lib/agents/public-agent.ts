import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents } from "@/lib/db/schema";
import { AppError } from "@/lib/http/errors";
import {
  createWidgetToken,
  domainAllowed,
  normalizeHost,
} from "@/lib/security/widget-token";

export async function publicAgentData(request: Request, agentId: string) {
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
      teaserMessages: agents.teaserMessages,
      attentionMessage: agents.attentionMessage,
      suggestedQuestions: agents.suggestedQuestions,
      helpCenterEnabled: agents.helpCenterEnabled,
      helpCenterGreeting: agents.helpCenterGreeting,
      collectFeedback: agents.collectFeedback,
      showCitations: agents.showCitations,
      showBranding: agents.showBranding,
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
  // Browsers omit `Origin` on same-origin GETs, and strict tracking protection
  // or a referrer policy can strip `Referer` too. Falling back to the host the
  // browser actually asked for keeps first-party requests working: a genuine
  // cross-origin embed still carries `Origin`, so the allowlist is unaffected.
  const servingHost =
    request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const requestingHost = normalizeHost(requestingUrl || servingHost);
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
  return { ...agent, embedToken };
}
