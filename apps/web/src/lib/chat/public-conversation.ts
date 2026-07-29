import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, conversations } from "@/lib/db/schema";
import { AppError } from "@/lib/http/errors";
import {
  domainAllowed,
  verifyWidgetToken,
} from "@/lib/security/widget-token";

export async function authorizePublicAgent(
  agentId: string,
  embedToken?: string,
) {
  const [agent] = await db
    .select({
      id: agents.id,
      status: agents.status,
      allowedDomains: agents.allowedDomains,
      workspaceId: agents.workspaceId,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent || agent.status === "paused") {
    throw new AppError("AGENT_NOT_AVAILABLE", "Agent is not available.", 404);
  }
  if (!embedToken && agent.allowedDomains.length) {
    throw new AppError(
      "WIDGET_TOKEN_REQUIRED",
      "This agent requires an authorized widget session.",
      403,
    );
  }
  if (embedToken) {
    const token = await verifyWidgetToken(embedToken, agent.id);
    if (
      token.host !== "__dashboard__" &&
      agent.allowedDomains.length &&
      !domainAllowed(token.host, agent.allowedDomains)
    ) {
      throw new AppError(
        "DOMAIN_NOT_ALLOWED",
        "This agent is not allowed on the requesting domain.",
        403,
      );
    }
  }
  return agent;
}

export async function visitorConversation({
  agentId,
  conversationId,
  visitorId,
  sessionId,
}: {
  agentId: string;
  conversationId: string;
  visitorId: string;
  sessionId?: string;
}) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.agentId, agentId),
        eq(conversations.externalUserId, visitorId),
        ...(sessionId ? [eq(conversations.sessionId, sessionId)] : []),
      ),
    )
    .limit(1);
  if (!conversation) {
    throw new AppError(
      "CONVERSATION_NOT_FOUND",
      "Conversation not found.",
      404,
    );
  }
  return conversation;
}
