import { and, count, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { AgentStudio } from "@/components/app/agent-studio";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import {
  agents,
  crawlJobs,
  documents,
  pinnedAnswers,
  sources,
} from "@/lib/db/schema";
import { createWidgetToken } from "@/lib/security/widget-token";

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const [{ agentId }, query, workspace] = await Promise.all([
    params,
    searchParams,
    getWorkspaceContext(),
  ]);
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspace.workspaceId)))
    .limit(1);
  if (!agent) notFound();
  const sourceList = await db
    .select({
      id: sources.id,
      type: sources.type,
      name: sources.name,
      rootUrl: sources.rootUrl,
      status: sources.status,
      pageLimit: sources.pageLimit,
      errorMessage: sources.errorMessage,
      lastSyncedAt: sources.lastSyncedAt,
      documentCount: count(documents.id),
    })
    .from(sources)
    .leftJoin(documents, eq(documents.sourceId, sources.id))
    .where(eq(sources.agentId, agentId))
    .groupBy(sources.id);
  const [job] = query.job
    ? await db
        .select()
        .from(crawlJobs)
        .where(eq(crawlJobs.id, query.job))
        .limit(1)
    : [undefined];
  const pinned = await db
    .select()
    .from(pinnedAnswers)
    .where(eq(pinnedAnswers.agentId, agent.id));
  const previewToken = await createWidgetToken(agent.id, "__dashboard__");
  return (
    <AgentStudio
      initialAgent={agent}
      initialJob={job}
      initialPinned={pinned}
      initialSources={sourceList}
      previewToken={previewToken}
    />
  );
}
