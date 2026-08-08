import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ChatPanel } from "@/components/chat/chat-panel";
import { db } from "@/lib/db/client";
import { resolveAvailability } from "@/lib/support/availability";
import { agents, operatorPresence } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Support",
  robots: { index: false, follow: false },
};

export default async function WidgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ agentId }, query] = await Promise.all([params, searchParams]);
  const [agent] = await db
    .select({
      id: agents.id,
      name: agents.name,
      status: agents.status,
      welcomeMessage: agents.welcomeMessage,
      primaryColor: agents.primaryColor,
      logoUrl: agents.logoUrl,
      iconUrl: agents.iconUrl,
      helpCenterEnabled: agents.helpCenterEnabled,
      helpCenterGreeting: agents.helpCenterGreeting,
      suggestedQuestions: agents.suggestedQuestions,
      collectFeedback: agents.collectFeedback,
      showBranding: agents.showBranding,
      businessHours: agents.businessHours,
      workspaceId: agents.workspaceId,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent || agent.status === "paused") notFound();
  // Resolved server-side: a visitor's clock cannot decide whether the support
  // team is open.
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
  return (
    <main className="widget-page">
      <ChatPanel
        agentId={agent.id}
        collectFeedback={agent.collectFeedback}
        embedded
        embedToken={query.token}
        logoUrl={agent.logoUrl}
        iconUrl={agent.iconUrl}
        availability={availability}
        helpCenterEnabled={agent.helpCenterEnabled}
        helpCenterGreeting={agent.helpCenterGreeting}
        name={agent.name}
        primaryColor={agent.primaryColor}
        showBranding={agent.showBranding}
        suggestedQuestions={agent.suggestedQuestions}
        welcomeMessage={agent.welcomeMessage}
      />
    </main>
  );
}
