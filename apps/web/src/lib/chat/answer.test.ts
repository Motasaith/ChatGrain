import { describe, expect, it } from "vitest";
import {
  contextualCitation,
  type AnswerHistoryMessage,
} from "./answer";

describe("conversation-aware article links", () => {
  it("returns the specific article cited by the previous answer", () => {
    const history: AnswerHistoryMessage[] = [
      {
        role: "user",
        content: "How do I build the water-level alarm?",
      },
      {
        role: "assistant",
        content:
          "The water-level alarm uses an LM324 comparator, copper probes, and an LED.",
        citations: [
          {
            chunkId: "home",
            title: "Project library",
            url: "https://example.com/",
            excerpt: "Browse every project.",
          },
          {
            chunkId: "article",
            title: "Build a water-level alarm",
            url: "https://example.com/build-a-water-level-alarm/",
            excerpt:
              "Use an LM324 comparator with copper probes and an LED indicator.",
          },
        ],
      },
    ];

    expect(
      contextualCitation("Give me a link to this article", history),
    ).toMatchObject({
      chunkId: "article",
      url: "https://example.com/build-a-water-level-alarm/",
    });
  });

  it("does not reuse a citation for an unrelated link request", () => {
    expect(
      contextualCitation("Where is your pricing link?", [
        {
          role: "assistant",
          content: "A previous answer",
          citations: [
            {
              chunkId: "old",
              title: "Old article",
              url: "https://example.com/old-article/",
              excerpt: "Old information",
            },
          ],
        },
      ]),
    ).toBeNull();
  });
});
