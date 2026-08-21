import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth/workspace";
import { db } from "@/lib/db/client";
import { agents, conversations, sources } from "@/lib/db/schema";
import { errorResponse } from "@/lib/http/errors";
import { likePattern } from "@/lib/search/like";

export const dynamic = "force-dynamic";

/** Enough to fill the palette without turning a broad query into a report. */
const PER_GROUP = 6;

export type SearchHit = {
  kind: "agent" | "conversation" | "source";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

/**
 * Backs the header search box.
 *
 * Scoped to the caller's workspace at the join, not filtered afterwards: every
 * one of these tables reaches its workspace through `agents`, so the join is
 * the only place the check cannot be forgotten.
 *
 * `ilike` rather than the vector index on purpose. This is a navigational
 * search - "take me to the thing I already know the name of" - and an operator
 * typing "sudo" wants the Sudo Scout agent, not the passage most semantically
 * similar to the word.
 */
export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const workspace = await getWorkspaceContext();
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2) {
      return NextResponse.json({ data: { hits: [], query }, requestId });
    }
    const like = likePattern(query);

    const [agentRows, conversationRows, sourceRows] = await Promise.all([
      db
        .select({ id: agents.id, name: agents.name, status: agents.status })
        .from(agents)
        .where(
          and(
            eq(agents.workspaceId, workspace.workspaceId),
            or(ilike(agents.name, like), ilike(agents.description, like)),
          ),
        )
        .orderBy(desc(agents.updatedAt))
        .limit(PER_GROUP),
      db
        .select({
          id: conversations.id,
          title: conversations.title,
          agentName: agents.name,
          lastMessageAt: conversations.lastMessageAt,
        })
        .from(conversations)
        .innerJoin(agents, eq(agents.id, conversations.agentId))
        .where(
          and(
            eq(agents.workspaceId, workspace.workspaceId),
            or(
              ilike(conversations.title, like),
              ilike(conversations.visitorEmail, like),
              ilike(conversations.visitorName, like),
            ),
          ),
        )
        .orderBy(sql`${conversations.lastMessageAt} desc nulls last`)
        .limit(PER_GROUP),
      db
        .select({
          id: sources.id,
          name: sources.name,
          rootUrl: sources.rootUrl,
          agentId: sources.agentId,
          agentName: agents.name,
        })
        .from(sources)
        .innerJoin(agents, eq(agents.id, sources.agentId))
        .where(
          and(
            eq(agents.workspaceId, workspace.workspaceId),
            or(ilike(sources.name, like), ilike(sources.rootUrl, like)),
          ),
        )
        .orderBy(desc(sources.updatedAt))
        .limit(PER_GROUP),
    ]);

    const hits: SearchHit[] = [
      ...agentRows.map((row) => ({
        kind: "agent" as const,
        id: row.id,
        title: row.name,
        subtitle: `Agent · ${row.status}`,
        href: `/dashboard/agents/${row.id}`,
      })),
      ...conversationRows.map((row) => ({
        kind: "conversation" as const,
        id: row.id,
        title: row.title || "Untitled conversation",
        subtitle: `Conversation · ${row.agentName}`,
        href: `/dashboard/activity/${row.id}`,
      })),
      ...sourceRows.map((row) => ({
        kind: "source" as const,
        id: row.id,
        title: row.name,
        subtitle: `Source · ${row.rootUrl ?? row.agentName}`,
        href: `/dashboard/agents/${row.agentId}`,
      })),
    ];

    return NextResponse.json({ data: { hits, query }, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
