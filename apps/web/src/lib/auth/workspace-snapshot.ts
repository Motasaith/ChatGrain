import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { actions, agents, pinnedAnswers, sources } from "@/lib/db/schema";

/**
 * A workspace's whole configuration, copied so it can be put back.
 *
 * This is what makes "change anything, decide afterwards" possible without the
 * copy-on-write machinery that would otherwise be needed. The trick is that an
 * administrator does not need their changes to be *invisible* while they work -
 * they need them to be *undoable* when they finish. Those are very different
 * problems, and the second one is just a copy.
 *
 * **Four tables, and deliberately only four.** Everything an administrator can
 * usefully change while diagnosing a fault is configuration: the agent and its
 * prompt, its sources, its pinned answers, its actions. A few rows each. What
 * is excluded matters as much:
 *
 * - **Documents and chunks** - the corpus. Thousands of rows carrying
 *   embeddings, and a re-index rewrites all of them. Copying that so it could
 *   be restored would cost more disk and time than the feature is worth, so a
 *   re-index is honestly declared as the one thing discarding cannot undo.
 * - **Conversations, leads, tickets** - the customer's own data, not
 *   configuration. An administrator has no business rolling those back, and a
 *   restore that deleted a lead which arrived during the session would be
 *   destroying real business.
 */

export type WorkspaceSnapshot = {
  takenAt: string;
  agents: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  pinnedAnswers: Record<string, unknown>[];
  actions: Record<string, unknown>[];
};

/** Everything a session may change, as it stands right now. */
export async function takeSnapshot(
  workspaceId: string,
): Promise<WorkspaceSnapshot> {
  const owned = await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId));
  const agentIds = owned.map((row) => row.id);

  const [sourceRows, pinnedRows, actionRows] = agentIds.length
    ? await Promise.all([
        db.select().from(sources).where(inArray(sources.agentId, agentIds)),
        db
          .select()
          .from(pinnedAnswers)
          .where(inArray(pinnedAnswers.agentId, agentIds)),
        db.select().from(actions).where(inArray(actions.agentId, agentIds)),
      ])
    : [[], [], []];

  return {
    takenAt: new Date().toISOString(),
    agents: owned as Record<string, unknown>[],
    sources: sourceRows as Record<string, unknown>[],
    pinnedAnswers: pinnedRows as Record<string, unknown>[],
    actions: actionRows as Record<string, unknown>[],
  };
}

/** Fields that say nothing about intent and would make every row look edited. */
const IGNORED = new Set(["updatedAt", "lastSyncedAt", "lastCrawledAt"]);

export type Change = {
  table: string;
  id: string;
  label: string;
  kind: "added" | "removed" | "changed";
  fields: string[];
};

function labelFor(table: string, row: Record<string, unknown>) {
  const named = row.name ?? row.title ?? row.question ?? row.rootUrl ?? row.id;
  return `${String(named)}`;
}

/**
 * Compares two rows, ignoring the fields that always move.
 *
 * Stringified rather than compared by reference: these come back from JSON in
 * one case and from the driver in the other, so a `Date` on one side is a
 * string on the other and every row would look changed.
 */
function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const differing: string[] = [];
  for (const key of keys) {
    if (IGNORED.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      differing.push(key);
    }
  }
  return differing;
}

function diffTable(
  table: string,
  before: Record<string, unknown>[],
  after: Record<string, unknown>[],
): Change[] {
  const byId = (rows: Record<string, unknown>[]) =>
    new Map(rows.map((row) => [String(row.id), row]));
  const was = byId(before);
  const now = byId(after);
  const changes: Change[] = [];

  for (const [id, row] of now) {
    const previous = was.get(id);
    if (!previous) {
      changes.push({
        table,
        id,
        label: labelFor(table, row),
        kind: "added",
        fields: [],
      });
      continue;
    }
    const fields = changedFields(previous, row);
    if (fields.length) {
      changes.push({
        table,
        id,
        label: labelFor(table, row),
        kind: "changed",
        fields,
      });
    }
  }
  for (const [id, row] of was) {
    if (!now.has(id)) {
      changes.push({
        table,
        id,
        label: labelFor(table, row),
        kind: "removed",
        fields: [],
      });
    }
  }
  return changes;
}

/** What has changed since the snapshot was taken. */
export function diffSnapshot(before: WorkspaceSnapshot, after: WorkspaceSnapshot) {
  return [
    ...diffTable("agents", before.agents, after.agents),
    ...diffTable("sources", before.sources, after.sources),
    ...diffTable("pinnedAnswers", before.pinnedAnswers, after.pinnedAnswers),
    ...diffTable("actions", before.actions, after.actions),
  ];
}

const TABLES = {
  agents,
  sources,
  pinnedAnswers,
  actions,
} as const;

export type RestoreResult = {
  restored: number;
  /** Rows left alone because somebody else had changed them since. */
  skipped: { table: string; label: string; reason: string }[];
};

/**
 * Puts a snapshot back.
 *
 * The interesting part is what it refuses to do. A row the *customer* edited
 * while the administrator was in there is not the administrator's change to
 * undo, and blindly writing the snapshot over it would silently destroy their
 * work - which is precisely the failure that would discredit this feature. So
 * each row's `updatedAt` is compared with the moment the snapshot was taken,
 * and anything touched after the session ended is left exactly as it is and
 * reported instead.
 *
 * `updatedAt` is maintained by a database trigger rather than by the code that
 * writes these tables, because a column that every write path has to remember
 * is a column that is wrong the first time one of them forgets - silently, and
 * in the direction of losing somebody's data.
 *
 * Rows the administrator *created* are deleted, since they did not exist in the
 * snapshot. Rows the administrator deleted are re-inserted.
 */
export async function restoreSnapshot(
  snapshot: WorkspaceSnapshot,
  workspaceId: string,
  { endedAt }: { endedAt: Date },
): Promise<RestoreResult> {
  const current = await takeSnapshot(workspaceId);
  const skipped: RestoreResult["skipped"] = [];
  let restored = 0;

  for (const key of ["agents", "sources", "pinnedAnswers", "actions"] as const) {
    const table = TABLES[key];
    const was = new Map(
      snapshot[key].map((row) => [String(row.id), row]),
    );
    const now = new Map(current[key].map((row) => [String(row.id), row]));

    for (const [id, previous] of was) {
      const live = now.get(id);
      if (live) {
        // Somebody edited it after the administrator left. Not theirs to undo.
        const touched = live.updatedAt ? new Date(String(live.updatedAt)) : null;
        if (touched && touched > endedAt) {
          skipped.push({
            table: key,
            label: labelFor(key, live),
            reason: "changed after the session ended",
          });
          continue;
        }
        if (!changedFields(previous, live).length) continue;
        await db
          .update(table)
          .set(previous as never)
          .where(eq(table.id, id));
        restored += 1;
        continue;
      }
      // Deleted during the session: put it back.
      await db.insert(table).values(previous as never);
      restored += 1;
    }

    for (const [id, live] of now) {
      if (was.has(id)) continue;
      // Created during the session, so it is part of what is being undone -
      // unless it appeared after the session ended, in which case it is the
      // customer's and must survive.
      const touched = live.updatedAt ? new Date(String(live.updatedAt)) : null;
      if (touched && touched > endedAt) {
        skipped.push({
          table: key,
          label: labelFor(key, live),
          reason: "created after the session ended",
        });
        continue;
      }
      await db.delete(table).where(eq(table.id, id));
      restored += 1;
    }
  }

  return { restored, skipped };
}
