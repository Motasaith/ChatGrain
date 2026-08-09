import { describe, expect, it } from "vitest";
import {
  groupContentGaps,
  questionKey,
  type UnansweredQuestion,
} from "./content-gaps";

const ask = (
  question: string,
  daysAgo = 0,
  conversationId = "c1",
): UnansweredQuestion => ({
  question,
  askedAt: new Date(Date.now() - daysAgo * 86_400_000),
  conversationId,
  agentName: "HOC",
});

describe("questionKey", () => {
  it("groups the same question asked politely and bluntly", () => {
    expect(questionKey("how do I cancel my subscription")).toBe(
      questionKey("can you tell me how to cancel the subscription please"),
    );
  });

  it("ignores word order", () => {
    expect(questionKey("cancel subscription")).toBe(
      questionKey("subscription cancel"),
    );
  });

  it("treats a plural as the same gap", () => {
    expect(questionKey("refund policy")).toBe(questionKey("refunds policy"));
  });

  it("keeps genuinely different topics apart", () => {
    expect(questionKey("how do I cancel")).not.toBe(
      questionKey("how do I upgrade"),
    );
    expect(questionKey("shipping times")).not.toBe(questionKey("refund policy"));
  });

  it("does not merge unrelated questions that are all framing", () => {
    // Both reduce to no distinctive terms; merging them would produce one
    // meaningless group that outranks every real gap.
    expect(questionKey("what is it")).not.toBe(questionKey("can you help"));
  });
});

describe("groupContentGaps", () => {
  it("ranks by how often a gap was hit", () => {
    const gaps = groupContentGaps([
      ask("do you ship to canada"),
      ask("how do I cancel my subscription"),
      ask("cancel subscription"),
      ask("can you tell me how to cancel the subscription"),
    ]);
    expect(gaps[0].count).toBe(3);
    expect(gaps[0].question.toLowerCase()).toContain("cancel");
    expect(gaps[1].count).toBe(1);
  });

  it("shows the fullest phrasing and keeps the others as variants", () => {
    const gaps = groupContentGaps([
      ask("cancel subscription"),
      ask("how do I cancel my subscription"),
    ]);
    expect(gaps[0].question).toBe("how do I cancel my subscription");
    expect(gaps[0].variants).toContain("cancel subscription");
  });

  it("keeps a bare one-word question separate from a detailed one", () => {
    // Deliberate. "refund" shares a term with "refund policy for damaged
    // items" but is not the same request, and merging on shared terms would
    // let a generic word like "time" swallow every specific gap under it.
    const gaps = groupContentGaps([
      ask("refund"),
      ask("what is your refund policy for damaged items"),
    ]);
    expect(gaps).toHaveLength(2);
  });

  it("reports the most recent occurrence, not the first", () => {
    const gaps = groupContentGaps([
      ask("shipping times", 9, "old"),
      ask("shipping time", 1, "recent"),
    ]);
    expect(gaps[0].conversationId).toBe("recent");
  });

  it("breaks ties on recency so a stale gap does not sit at the top", () => {
    const gaps = groupContentGaps([
      ask("older topic", 30, "a"),
      ask("newer topic", 1, "b"),
    ]);
    expect(gaps[0].conversationId).toBe("b");
  });

  it("ignores blank questions rather than making an empty group", () => {
    expect(groupContentGaps([ask("   "), ask("real question")])).toHaveLength(1);
  });

  it("caps the list", () => {
    // Words, not digits: anything under three characters is stripped, so
    // "topic 1" and "topic 2" would correctly be the same gap.
    const many = Array.from({ length: 60 }, (_, i) =>
      ask(`question about widget${String.fromCharCode(97 + (i % 26))}${i}`),
    );
    expect(groupContentGaps(many, 10)).toHaveLength(10);
  });

  it("returns nothing for no input", () => {
    expect(groupContentGaps([])).toEqual([]);
  });
});
