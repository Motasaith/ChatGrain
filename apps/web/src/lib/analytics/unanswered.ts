import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  groupContentGaps,
  type ContentGap,
  type UnansweredQuestion,
} from "./content-gaps";

/**
 * The questions this workspace's agents could not answer.
 *
 * A refusal is stored as an assistant message with grounded = false; the
 * question that caused it is the visitor's previous message in that thread.
 * The lateral join walks backwards from each refusal rather than pairing by
 * row order, which would break the moment an operator or system message
 * landed between the two.
 */
export async function unansweredQuestions(
  workspaceId: string,
  { days = 30, limit = 25 }: { days?: number; limit?: number } = {},
): Promise<ContentGap[]> {
  type Row = {
    question: string;
    asked_at: string;
    conversation_id: string;
    agent_id: string;
    agent_name: string;
  };
  const result = await db.execute<Row>(sql`
    select
      q.content as question,
      m.created_at as asked_at,
      c.id as conversation_id,
      a.id as agent_id,
      a.name as agent_name
    from messages m
    join conversations c on c.id = m.conversation_id
    join agents a on a.id = c.agent_id
    join lateral (
      select content
      from messages earlier
      where earlier.conversation_id = m.conversation_id
        and earlier.role = 'user'
        and earlier.created_at <= m.created_at
      order by earlier.created_at desc
      limit 1
    ) q on true
    where a.workspace_id = ${workspaceId}::uuid
      and m.role = 'assistant'
      and m.grounded = false
      and m.created_at > now() - make_interval(days => ${days})
    order by m.created_at desc
    limit 2000
  `);

  // Drivers disagree on the shape: postgres.js returns the rows directly,
  // pglite wraps them in { rows }. Accept either rather than assuming.
  const rows: Row[] = Array.isArray(result)
    ? result
    : ((result as { rows?: Row[] })?.rows ?? []);

  const questions: UnansweredQuestion[] = rows.map((row) => ({
    question: row.question ?? "",
    askedAt: new Date(row.asked_at),
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
  }));
  return groupContentGaps(questions, limit);
}
