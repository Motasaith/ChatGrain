import { describe, expect, it } from "vitest";
import { retrievalQueryTerms, siteStopWords } from "./query-terms";

describe("retrievalQueryTerms", () => {
  it("drops generic question framing", () => {
    expect(retrievalQueryTerms("what is your refund policy")).toEqual([
      "refund",
      "policy",
    ]);
  });

  it("never strips a query down to nothing", () => {
    // An empty term list zeroes both the lexical and title components of the
    // confidence score - 55% of its weight - which pushes even a correct match
    // under the grounding threshold. Keeping the raw terms is always better
    // than keeping none.
    expect(retrievalQueryTerms("what is this about")).not.toHaveLength(0);
  });

  it("keeps site words when they are all the visitor gave", () => {
    const terms = retrievalQueryTerms("raspberry projects", {
      siteWords: new Set(["raspberry", "projects"]),
    });
    expect(terms).toEqual(["raspberry", "projects"]);
  });

  it("drops site words when other terms survive", () => {
    // On projects-raspberry.com every page matches "raspberry", so it cannot
    // discriminate; "camera" is the whole signal.
    expect(
      retrievalQueryTerms("raspberry camera projects", {
        siteWords: new Set(["raspberry", "projects"]),
      }),
    ).toEqual(["camera"]);
  });

  it("treats a trailing 'work' as question framing, not a topic", () => {
    expect(retrievalQueryTerms("how does the time calculator work")).toEqual([
      "time",
      "calculator",
    ]);
    expect(retrievalQueryTerms("how do refunds work?")).toEqual(["refunds"]);
  });

  it("keeps 'work' when it is the subject", () => {
    // homeofcalculators.com has a genuine /calculators/work page, so a blanket
    // stopword would make it unreachable.
    expect(retrievalQueryTerms("work calculator")).toEqual([
      "work",
      "calculator",
    ]);
    expect(retrievalQueryTerms("how much work is a joule")).toContain("work");
  });

  it("deduplicates and caps runaway queries", () => {
    const long = Array.from({ length: 60 }, (_, i) => `term${i}`).join(" ");
    expect(retrievalQueryTerms(long)).toHaveLength(24);
    expect(retrievalQueryTerms("policy policy policy")).toEqual(["policy"]);
  });
});

describe("siteStopWords", () => {
  it("derives the site's own words from its domain", () => {
    const words = siteStopWords(["https://projects-raspberry.com/"]);
    expect(words.has("raspberry")).toBe(true);
    expect(words.has("projects")).toBe(true);
  });

  it("covers singular and plural so both phrasings are handled", () => {
    const words = siteStopWords(["https://projects-raspberry.com/"]);
    expect(words.has("project")).toBe(true);
  });

  it("ignores the TLD and www", () => {
    const words = siteStopWords(["https://www.example.com/"]);
    expect(words.has("com")).toBe(false);
    expect(words.has("www")).toBe(false);
    expect(words.has("example")).toBe(true);
  });

  it("leaves a single-token domain alone rather than guessing at splits", () => {
    // "homeofcalculators" is one label; inventing "calculators" from it would
    // strip the very word visitors search for.
    const words = siteStopWords(["https://homeofcalculators.com/"]);
    expect(words.has("calculators")).toBe(false);
    expect(words.has("homeofcalculators")).toBe(true);
  });

  it("survives junk input without throwing", () => {
    expect(() => siteStopWords(["not a url", "", "https://a.io"])).not.toThrow();
  });
});
