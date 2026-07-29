import { describe, expect, it } from "vitest";
import { parseCsvRecords } from "./ingest-csv";

describe("CSV source parsing", () => {
  it("preserves quoted multiline cells and permalink metadata", () => {
    const records = parseCsvRecords(
      [
        "id,Title,Summary,Permalink",
        '9,"First, useful post","Line one',
        'line two","https://example.com/posts/first#details"',
        '15,"Newest post","A concise summary","https://example.com/posts/newest"',
      ].join("\n"),
      "posts.csv",
    );

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      title: "First, useful post",
      canonicalUrl: "https://example.com/posts/first",
      metadata: { rowNumber: 2, sortValue: 9 },
    });
    expect(records[0].content).toContain("Line one\nline two");
    expect(records[1]).toMatchObject({
      title: "Newest post",
      canonicalUrl: "https://example.com/posts/newest",
      metadata: { sortValue: 15 },
    });
  });
});
