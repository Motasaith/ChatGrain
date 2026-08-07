import { describe, expect, it } from "vitest";

import { normalizePdfText } from "./ingest-pdf";

describe("normalizePdfText", () => {
  it("rejoins words hyphenated across a line break", () => {
    // PDF text layers break words at the line edge; left alone the embedding
    // sees "config" and "uration" as separate tokens.
    expect(normalizePdfText("the config-\nuration file")).toBe(
      "the configuration file",
    );
  });

  it("joins hard-wrapped sentences", () => {
    expect(normalizePdfText("refunds are issued\nwithin thirty days")).toBe(
      "refunds are issued within thirty days",
    );
  });

  it("keeps paragraph breaks", () => {
    expect(normalizePdfText("First para.\n\nSecond para.")).toBe(
      "First para.\n\nSecond para.",
    );
  });

  it("does not join across a sentence end", () => {
    // A capital after the break signals a new sentence, not a wrap.
    expect(normalizePdfText("End of one.\nNew sentence")).toBe(
      "End of one.\nNew sentence",
    );
  });

  it("collapses runs of whitespace and non-breaking spaces", () => {
    expect(normalizePdfText("a    b")).toBe("a b");
  });
});
