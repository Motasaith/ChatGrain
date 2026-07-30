import { describe, expect, it } from "vitest";

import { SpeechChunker, parsePcmSampleRate, speakableText } from "./tts";

describe("parsePcmSampleRate", () => {
  it("reads the rate the speech server declares", () => {
    // Self-hosted Piper voices are 22.05 kHz, not the 24 kHz OpenAI emits;
    // trusting a configured default here shifts pitch and tempo.
    expect(parsePcmSampleRate("audio/pcm;rate=22050")).toBe(22_050);
    expect(parsePcmSampleRate("audio/pcm; rate=24000")).toBe(24_000);
  });

  it("falls back when no rate is declared", () => {
    expect(parsePcmSampleRate("audio/pcm")).toBeNull();
    expect(parsePcmSampleRate(null)).toBeNull();
    expect(parsePcmSampleRate("audio/pcm;rate=abc")).toBeNull();
  });
});

describe("speakableText", () => {
  it("removes markdown a speech engine would read as punctuation", () => {
    expect(speakableText("**Bold** and *italic* and `code`")).toBe(
      "Bold and italic and code",
    );
    expect(speakableText("## Heading\n- one\n- two")).toBe("Heading\none\ntwo");
  });

  it("drops citation markers", () => {
    expect(speakableText("Returns take 30 days [1].")).toBe(
      "Returns take 30 days.",
    );
    expect(speakableText("Both apply [1, 2] here.")).toBe("Both apply here.");
  });

  it("keeps link labels but never reads a raw URL", () => {
    expect(speakableText("See [our returns page](https://x.test/returns).")).toBe(
      "See our returns page.",
    );
    expect(speakableText("Go to https://x.test/returns now")).toBe(
      "Go to the link on screen now",
    );
  });

  it("returns nothing for content that is entirely unspeakable", () => {
    expect(speakableText("```js\nconst a = 1;\n```")).toBe("");
  });
});

describe("SpeechChunker", () => {
  it("releases a short first chunk so audio can start early", () => {
    const chunker = new SpeechChunker();
    expect(chunker.push("Hello there. ")).toEqual(["Hello there."]);
  });

  it("does not split on abbreviations", () => {
    const chunker = new SpeechChunker();
    expect(chunker.push("Contact Dr. ")).toEqual([]);
    expect(chunker.push("Smith about the refund policy today. ")).toEqual([
      "Contact Dr. Smith about the refund policy today.",
    ]);
  });

  it("breaks very long unpunctuated output so synthesis still starts", () => {
    const chunker = new SpeechChunker(60, 80);
    const chunks = chunker.push(`${"word ".repeat(40)}`);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].length).toBeLessThanOrEqual(80);
  });

  it("flushes the trailing partial sentence", () => {
    const chunker = new SpeechChunker();
    chunker.push("All done. ");
    chunker.push("One more thing");
    expect(chunker.flush()).toBe("One more thing");
    expect(chunker.flush()).toBeNull();
  });
});
