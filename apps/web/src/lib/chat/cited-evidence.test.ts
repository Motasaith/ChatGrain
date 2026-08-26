import { describe, expect, it } from "vitest";
import { citedEvidence } from "./answer";

const hit = (id: string, url: string) =>
  ({
    chunkId: id,
    documentId: id,
    title: `Page ${id}`,
    url,
    content: "some content",
  }) as never;

const HITS = [
  hit("1", "https://s.test/a"),
  hit("2", "https://s.test/b"),
  hit("3", "https://s.test/c"),
];

describe("citedEvidence", () => {
  it("returns the evidence the answer pointed at", () => {
    const out = citedEvidence("Yes, the CSV viewer supports that [2].", HITS);
    expect(out.map((h) => h.url)).toEqual(["https://s.test/b"]);
  });

  it("reads several markers, including a grouped one", () => {
    const out = citedEvidence("Both work [1, 3].", HITS);
    expect(out.map((h) => h.url)).toEqual([
      "https://s.test/a",
      "https://s.test/c",
    ]);
  });

  // The regression. An answer that rests on no page used to be given the first
  // two hits, so the widget captioned an arithmetic correction - "you are right,
  // it is 23" - with "2 sources used" and two unrelated pages. A reader who
  // opens one of those and finds nothing relevant stops trusting the next one.
  it("returns nothing when the answer cited nothing", () => {
    expect(
      citedEvidence("I apologize for the error. It does add up to 23.", HITS),
    ).toEqual([]);
  });

  it("ignores markers that point outside the evidence", () => {
    expect(citedEvidence("As shown [9].", HITS)).toEqual([]);
  });

  it("does not repeat the same page cited twice", () => {
    const dupes = [hit("1", "https://s.test/a"), hit("2", "https://s.test/a")];
    expect(citedEvidence("Both [1] and [2].", dupes)).toHaveLength(1);
  });
});
