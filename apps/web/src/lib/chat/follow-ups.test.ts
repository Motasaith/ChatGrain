import { describe, expect, it } from "vitest";
import { cleanSuggestionTitle, suggestFollowUps } from "./follow-ups";
import type { RetrievalHit } from "@/lib/rag/retrieve";

function hit(partial: Partial<RetrievalHit> & { title: string }): RetrievalHit {
  return {
    chunkId: partial.chunkId ?? Math.random().toString(36).slice(2),
    documentId: partial.documentId ?? partial.title,
    content: partial.content ?? "",
    title: partial.title,
    url: partial.url ?? `https://example.com/${partial.title}`,
    vectorScore: 0.5,
    keywordScore: 0.1,
    score: 0.5,
    position: 0,
    lexicalScore: 0.5,
    titleScore: 0.5,
    rankScore: partial.rankScore ?? 0.5,
  };
}

describe("cleanSuggestionTitle", () => {
  it("drops the site name that most CMSes append to every title", () => {
    expect(cleanSuggestionTitle("Time Calculator | Home of Calculators")).toBe(
      "Time Calculator",
    );
    expect(cleanSuggestionTitle("Refund Policy - Acme Store")).toBe(
      "Refund Policy",
    );
    expect(cleanSuggestionTitle("Pricing – Acme")).toBe("Pricing");
  });

  it("keeps a hyphen that belongs to the topic", () => {
    // Splitting on every dash would turn this into "Set". The separator only
    // counts when what follows looks like a trailing site name.
    expect(cleanSuggestionTitle("Set-up guide")).toBe("Set-up guide");
  });

  it("trims whitespace and collapses runs", () => {
    expect(cleanSuggestionTitle("  Time   Calculator  ")).toBe("Time Calculator");
  });
});

describe("suggestFollowUps", () => {
  it("suggests other retrieved pages, not the one just answered", () => {
    const hits = [
      hit({ title: "Time Calculator", documentId: "a" }),
      hit({ title: "Time Duration Calculator", documentId: "b" }),
      hit({ title: "Time Zone Calculator", documentId: "c" }),
    ];
    const result = suggestFollowUps({
      hits,
      question: "how does the time calculator work",
      answeredDocumentIds: ["a"],
    });
    expect(result).not.toContain("Time Calculator");
    expect(result.some((s) => s.includes("Time Duration Calculator"))).toBe(true);
  });

  it("never repeats what the visitor already asked", () => {
    const result = suggestFollowUps({
      hits: [hit({ title: "Refund Policy", documentId: "a" })],
      question: "what is the refund policy?",
      answeredDocumentIds: [],
    });
    expect(result).toHaveLength(0);
  });

  it("deduplicates pages that share a title across URLs", () => {
    const hits = [
      hit({ title: "Pricing", documentId: "a" }),
      hit({ title: "Pricing", documentId: "b" }),
      hit({ title: "Support", documentId: "c" }),
    ];
    const result = suggestFollowUps({
      hits,
      question: "tell me about billing",
      answeredDocumentIds: [],
    });
    expect(result).toHaveLength(2);
  });

  it("returns at most three so the widget stays readable", () => {
    const hits = Array.from({ length: 9 }, (_, i) =>
      hit({ title: `Topic ${i}`, documentId: `d${i}` }),
    );
    expect(
      suggestFollowUps({ hits, question: "anything", answeredDocumentIds: [] }),
    ).toHaveLength(3);
  });

  it("skips junk titles that would read as nonsense chips", () => {
    const hits = [
      hit({ title: "Home", documentId: "a" }),
      hit({ title: "404", documentId: "b" }),
      hit({ title: "Untitled", documentId: "c" }),
      hit({ title: "Shipping Times", documentId: "d" }),
    ];
    const result = suggestFollowUps({
      hits,
      question: "delivery",
      answeredDocumentIds: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Shipping Times");
  });

  it("returns nothing when the answer was ungrounded", () => {
    // A refusal means the evidence was not trusted. Offering confident
    // follow-ups built from that same evidence would be misleading.
    expect(
      suggestFollowUps({
        hits: [hit({ title: "Pricing", documentId: "a" })],
        question: "x",
        answeredDocumentIds: [],
        grounded: false,
      }),
    ).toHaveLength(0);
  });
});
