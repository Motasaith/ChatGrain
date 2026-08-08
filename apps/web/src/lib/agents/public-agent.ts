import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, operatorPresence } from "@/lib/db/schema";
import { AppError } from "@/lib/http/errors";
import { resolveAvailability } from "@/lib/support/availability";
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
      followUpSuggestions: agents.followUpSuggestions,
      businessHours: agents.businessHours,
      workspaceId: agents.workspaceId,
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
  // Resolved here rather than in the widget: business hours and operator
  // presence are both server state, and a client clock cannot be trusted to
  // decide whether a team is open.
  const [presence] = await db
    .select({ lastSeenAt: operatorPresence.lastSeenAt })
    .from(operatorPresence)
    .where(eq(operatorPresence.workspaceId, agent.workspaceId))
    .orderBy(desc(operatorPresence.lastSeenAt))
    .limit(1);
  const availability = resolveAvailability({
    businessHours: agent.businessHours,
    lastOperatorSeenAt: presence?.lastSeenAt ?? null,
  });
  // workspaceId and the raw schedule are internal; only the resolved
  // availability belongs in a payload any website can read.
  const publicAgent = { ...agent } as Partial<typeof agent>;
  delete publicAgent.workspaceId;
  delete publicAgent.businessHours;
  return { ...publicAgent, embedToken, availability };
}
