import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PINNED_MATCH_THRESHOLD, pinnedMatchScore, terms } from "./answer";

const matches = (question: string, pinned: string) =>
  pinnedMatchScore(question, pinned) >= PINNED_MATCH_THRESHOLD;

describe("terms", () => {
  it("folds a plural onto its singular", () => {
    expect(terms("refunds")).toEqual(terms("refund"));
    expect(terms("shipping times")).toEqual(terms("shipping time"));
  });

  it("leaves short words and false plurals alone", () => {
    // Stripping these would corrupt real words rather than fix a plural.
    expect([...terms("gas status analysis")]).toEqual(
      expect.arrayContaining(["gas", "status", "analysis"]),
    );
  });

  it("handles -es plurals without mangling the stem", () => {
    expect(terms("boxes")).toEqual(terms("box"));
    expect(terms("classes")).toEqual(terms("class"));
  });
});

describe("pinnedMatchScore", () => {
  it("fires for a plural the pin did not list", () => {
    // The gap singularisation closes. Measured before the change these scored
    // 0.5 and 0.612, both under the 0.72 threshold, so the pin stayed silent
    // over nothing but an "s".
    expect(matches("refunds policy", "refund policy")).toBe(true);
    expect(matches("do you offer refunds", "do you offer a refund")).toBe(true);
    expect(
      matches("what are your shipping times", "what is your shipping time"),
    ).toBe(true);
  });

  it("still needs a listed variation for a genuinely different phrasing", () => {
    // Honest boundary: "do you offer refunds" and "what is your refund policy"
    // share one word out of five and score 0.408. Matching them would be the
    // false positive the threshold exists to prevent - the questions[] array
    // is how a pin covers wording this different.
    expect(matches("do you offer refunds", "What is your refund policy?")).toBe(
      false,
    );
  });

  it("still fires for the exact phrasing", () => {
    expect(
      matches("what is your refund policy", "What is your refund policy?"),
    ).toBe(true);
  });

  it("does not fire for a different question sharing one word", () => {
    // A pin skips retrieval entirely, so a false positive silently replaces a
    // correct answer. This is the case that must stay closed.
    expect(matches("how long does refund processing take at the bank", "What is your refund policy?"))
      .toBe(false);
    expect(matches("what is your shipping policy", "What is your refund policy?"))
      .toBe(false);
  });

  it("does not fire for an unrelated question", () => {
    expect(matches("do you ship to canada", "What is your refund policy?")).toBe(
      false,
    );
  });

  it("is not fooled by a long pin containing the whole question", () => {
    // Plain overlap-over-query-size would score this 1.0; cosine does not.
    expect(
      matches(
        "refund",
        "What is your refund policy for damaged items bought during a sale",
      ),
    ).toBe(false);
  });

  it("scores nothing for empty or stopword-only input", () => {
    expect(pinnedMatchScore("", "refund policy")).toBe(0);
    expect(pinnedMatchScore("the and this", "refund policy")).toBe(0);
  });
});
