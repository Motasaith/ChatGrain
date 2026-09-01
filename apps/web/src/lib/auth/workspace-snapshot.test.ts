import { describe, expect, it } from "vitest";
import { diffSnapshot, type WorkspaceSnapshot } from "./workspace-snapshot";

/**
 * The diff an administrator is shown before deciding to keep or discard.
 *
 * It has to be right in both directions. Missing a change means somebody keeps
 * an edit they would have undone had they seen it; inventing one means the
 * dialog cries wolf, and a dialog that always lists something is a dialog
 * people stop reading - which is the same as not having one.
 */

const empty = (): WorkspaceSnapshot => ({
  takenAt: new Date().toISOString(),
  agents: [],
  sources: [],
  pinnedAnswers: [],
  actions: [],
});

const withAgents = (agents: Record<string, unknown>[]): WorkspaceSnapshot => ({
  ...empty(),
  agents,
});

describe("diffing a snapshot", () => {
  it("finds nothing when nothing changed", () => {
    const snapshot = withAgents([{ id: "a1", name: "Support", systemPrompt: "Be kind" }]);
    expect(diffSnapshot(snapshot, structuredClone(snapshot))).toEqual([]);
  });

  it("names the field that changed, not just the row", () => {
    const before = withAgents([{ id: "a1", name: "Support", systemPrompt: "Be kind" }]);
    const after = withAgents([{ id: "a1", name: "Support", systemPrompt: "Be blunt" }]);
    const [change] = diffSnapshot(before, after);
    expect(change).toMatchObject({
      table: "agents",
      id: "a1",
      kind: "changed",
      label: "Support",
      fields: ["systemPrompt"],
    });
  });

  it("sees a row added during the session", () => {
    const after = withAgents([{ id: "a1", name: "New agent" }]);
    expect(diffSnapshot(empty(), after)).toMatchObject([
      { kind: "added", label: "New agent" },
    ]);
  });

  it("sees a row deleted during the session", () => {
    const before = withAgents([{ id: "a1", name: "Old agent" }]);
    expect(diffSnapshot(before, empty())).toMatchObject([
      { kind: "removed", label: "Old agent" },
    ]);
  });

  /**
   * The bookkeeping columns move on every write and say nothing about intent.
   * Counting them would make every row look edited, and a list where everything
   * is always listed is a list nobody reads.
   */
  it("ignores timestamps that move on their own", () => {
    const before = withAgents([
      { id: "a1", name: "Support", updatedAt: "2026-09-01T10:00:00Z" },
    ]);
    const after = withAgents([
      { id: "a1", name: "Support", updatedAt: "2026-09-01T11:30:00Z" },
    ]);
    expect(diffSnapshot(before, after)).toEqual([]);
  });

  /**
   * One side comes back from JSON in the database and the other straight from
   * the driver, so a Date on one side is a string on the other. Compared by
   * value rather than by reference, or every row would look changed every time.
   */
  it("does not mistake a serialised value for a different one", () => {
    const before = withAgents([
      { id: "a1", name: "Support", suggestedQuestions: ["a", "b"] },
    ]);
    const after = withAgents([
      { id: "a1", name: "Support", suggestedQuestions: ["a", "b"] },
    ]);
    expect(diffSnapshot(before, after)).toEqual([]);
  });

  it("notices a field that was added or removed, not only one that moved", () => {
    const before = withAgents([{ id: "a1", name: "Support" }]);
    const after = withAgents([{ id: "a1", name: "Support", welcomeMessage: "Hi" }]);
    expect(diffSnapshot(before, after)[0]).toMatchObject({
      kind: "changed",
      fields: ["welcomeMessage"],
    });
  });

  it("covers every table a session can change", () => {
    const before: WorkspaceSnapshot = {
      ...empty(),
      sources: [{ id: "s1", name: "Docs" }],
      pinnedAnswers: [{ id: "p1", question: "Refunds?" }],
      actions: [{ id: "x1", name: "Escalate" }],
    };
    const after: WorkspaceSnapshot = {
      ...empty(),
      sources: [{ id: "s1", name: "Documentation" }],
      pinnedAnswers: [{ id: "p1", question: "Refunds?" }],
      actions: [],
    };
    const changes = diffSnapshot(before, after);
    expect(changes.map((change) => `${change.table}:${change.kind}`).sort()).toEqual([
      "actions:removed",
      "sources:changed",
    ]);
  });

  it("labels a row by something a person recognises", () => {
    const before = empty();
    const after: WorkspaceSnapshot = {
      ...empty(),
      sources: [{ id: "s1", rootUrl: "https://example.com" }],
      pinnedAnswers: [{ id: "p1", question: "Do you ship to Canada?" }],
    };
    expect(diffSnapshot(before, after).map((change) => change.label)).toEqual([
      "https://example.com",
      "Do you ship to Canada?",
    ]);
  });
});
