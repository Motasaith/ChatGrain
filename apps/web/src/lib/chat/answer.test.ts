import { describe, expect, it } from "vitest";
import {
  asksForHumanSupport,
  cleanGeneratedAnswer,
  contextualCitation,
  type AnswerHistoryMessage,
} from "./answer";
import { parseConversationIntent } from "@/lib/llm/client";

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

  it("rejects archive pages when resolving a specific article", () => {
    expect(
      contextualCitation("Can I have a link to this project?", [
        {
          role: "assistant",
          content: "The controller supports scheduled wake-up.",
          citations: [
            {
              chunkId: "archive",
              title: "Other Projects Archives",
              url: "https://example.com/projects/other-projects/",
              excerpt: "Browse controller projects.",
            },
            {
              chunkId: "article",
              title: "Power Controller: Shutdown and Wake-Up",
              url: "https://example.com/power-controller-shutdown-wake-up/",
              excerpt: "The controller supports scheduled wake-up.",
            },
          ],
        },
      ]),
    ).toMatchObject({ chunkId: "article" });
  });
});

describe("answer presentation", () => {
  it("recognizes explicit human handoff requests", () => {
    expect(asksForHumanSupport("Can I talk to customer support?")).toBe(true);
    expect(asksForHumanSupport("can i contact the support team")).toBe(true);
    expect(
      asksForHumanSupport("I need to get in touch with the website owner"),
    ).toBe(true);
    expect(asksForHumanSupport("Please have someone call me")).toBe(true);
    expect(
      asksForHumanSupport("Is there a direct email for my enquiry?"),
    ).toBe(true);
    expect(
      asksForHumanSupport("mujhe support team se baat karni hai"),
    ).toBe(true);
    expect(asksForHumanSupport("admin se rabta karwa dein")).toBe(true);
    expect(asksForHumanSupport("koi mujhe call kare")).toBe(true);
    expect(
      asksForHumanSupport("کیا میں کسی انسان سے بات کر سکتا ہوں؟"),
    ).toBe(true);
    expect(asksForHumanSupport("How does this circuit work?")).toBe(false);
    expect(
      asksForHumanSupport("Does this library support Raspberry Pi 5?"),
    ).toBe(false);
    expect(
      asksForHumanSupport("How does customer support software work?"),
    ).toBe(false);
    expect(
      asksForHumanSupport("What is a support vector machine?"),
    ).toBe(false);
  });

  it("accepts only the explicit handoff label from the intent model", () => {
    expect(parseConversationIntent("HUMAN_HANDOFF")).toBe("human_handoff");
    expect(parseConversationIntent(" HUMAN_HANDOFF\n")).toBe(
      "human_handoff",
    );
    expect(parseConversationIntent("KNOWLEDGE")).toBe("knowledge");
    expect(parseConversationIntent("I think this is a handoff")).toBe(
      "knowledge",
    );
  });

  it("removes internal evidence markers including grouped references", () => {
    expect(
      cleanGeneratedAnswer(
        "It supports timed wake-ups [1, 3]. It uses low standby power [2].",
      ),
    ).toBe(
      "It supports timed wake-ups. It uses low standby power.",
    );
  });
});
