import { describe, expect, it } from "vitest";
import {
  addRequestedEvidenceLinks,
  asksToFindPageFromImage,
  asksForHumanSupport,
  cleanGeneratedAnswer,
  contextualCitation,
  contextualRetrievalQuestion,
  projectListFallback,
  referencesConversationImage,
  type AnswerHistoryMessage,
} from "./answer";
import { parseConversationIntent } from "@/lib/llm/client";
import {
  retrievalQueryTerms,
  type RetrievalHit,
} from "@/lib/rag/retrieve";

describe("conversation-aware article links", () => {
  it("recognizes image-based page searches and conversational follow-ups", () => {
    expect(
      asksToFindPageFromImage("Can you find this post from the picture?"),
    ).toBe(true);
    expect(
      asksToFindPageFromImage(
        "I told you to find the post from the given pic above",
      ),
    ).toBe(true);
    expect(referencesConversationImage("Tell me more about that image")).toBe(
      true,
    );
    expect(asksToFindPageFromImage("How does this circuit work?")).toBe(false);
  });

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

  it("does not pollute an explicit new topic with an earlier handoff", () => {
    const question =
      "I want more information about Fun DIY Raspberry Pi because I am working on it";
    expect(
      contextualRetrievalQuestion(question, [
        {
          role: "user",
          content: "I want to contact the admin",
        },
        {
          role: "assistant",
          content:
            "I can ask the website team to contact you. Submit your details below.",
          grounded: true,
        },
      ]),
    ).toBe(question);
  });

  it("keeps the distinctive words for conversational searches", () => {
    expect(
      retrievalQueryTerms(
        "I want more information about Fun DIY Raspberry Pi because I am working on it. Do you have a similar article?",
      ),
    ).toEqual(["fun", "diy"]);
    expect(
      retrievalQueryTerms(
        "I want to build a final year project. Enlist 3 projects using Nano Raspberry and weather, with titles and URLs.",
      ),
    ).toEqual(["nano", "weather"]);
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

  it("adds clickable indexed links when related articles are requested", () => {
    expect(
      addRequestedEvidenceLinks(
        "Here are two related projects.",
        "Do you have a similar article?",
        [
          {
            chunkId: "one",
            documentId: "doc-one",
            content: "First project",
            title: "First project",
            url: "https://example.com/first-project/",
            vectorScore: 0.8,
            keywordScore: 1,
            score: 1,
            position: 0,
            lexicalScore: 1,
            titleScore: 1,
            rankScore: 1,
          },
          {
            chunkId: "two",
            documentId: "doc-two",
            content: "Second project",
            title: "Second project",
            url: "https://example.com/second-project/",
            vectorScore: 0.7,
            keywordScore: 1,
            score: 1,
            position: 0,
            lexicalScore: 1,
            titleScore: 1,
            rankScore: 1,
          },
        ],
      ),
    ).toContain(
      "- [First project](https://example.com/first-project/)",
    );
    expect(
      addRequestedEvidenceLinks(
        "Open https://example.com/first-project/ for details.",
        "List a related article",
        [],
      ),
    ).toBe("Open https://example.com/first-project/ for details.");
  });

  it("returns the requested number of clean linked projects without a model", () => {
    const hits = ["Weather station", "Air monitor", "Home monitor"].map(
      (title, index): RetrievalHit => ({
        chunkId: `chunk-${index}`,
        documentId: `doc-${index}`,
        content: `id: ${index}\nTitle: ${title}\nCategories: Projects\n_smart_summary: ${title} uses verified sensors and a Raspberry Pi.`,
        title,
        url: `https://example.com/project-${index}/`,
        vectorScore: 0.7,
        keywordScore: 1,
        score: 1,
        position: 0,
        lexicalScore: 1,
        titleScore: 1,
        rankScore: 1,
      }),
    );
    const result = projectListFallback(
      "Enlist 3 projects with their titles and URLs",
      hits,
    );
    expect(result?.hits).toHaveLength(3);
    expect(result?.answer.match(/https:\/\/example\.com/g)).toHaveLength(3);
    expect(result?.answer).not.toContain("Categories:");
    expect(result?.answer).not.toContain("_smart_summary:");
  });
});
