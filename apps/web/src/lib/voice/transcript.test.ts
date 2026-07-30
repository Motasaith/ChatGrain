import { describe, expect, it } from "vitest";

import { cleanTranscript } from "./transcript";

describe("cleanTranscript", () => {
  it("discards whisper's non-speech annotations", () => {
    // These reached the model verbatim before, so a doorbell in the background
    // was answered as if the visitor had asked about bells.
    expect(cleanTranscript("[BELL RINGING]")).toBe("");
    expect(cleanTranscript("[BLANK_AUDIO]")).toBe("");
    expect(cleanTranscript("  (silence) ")).toBe("");
    expect(cleanTranscript("[MUSIC PLAYING]")).toBe("");
  });

  it("keeps real speech that follows an annotation", () => {
    expect(cleanTranscript("[BELL RINGING] how do refunds work?")).toBe(
      "how do refunds work?",
    );
    expect(cleanTranscript("(door closes) (cough) is anyone there")).toBe(
      "is anyone there",
    );
  });

  it("leaves ordinary speech untouched", () => {
    expect(cleanTranscript(" Do you ship to Canada? ")).toBe(
      "Do you ship to Canada?",
    );
    // Brackets inside a sentence are not an annotation.
    expect(cleanTranscript("the plan [basic] costs ten pounds")).toBe(
      "the plan [basic] costs ten pounds",
    );
  });

  it("handles missing input", () => {
    expect(cleanTranscript(null)).toBe("");
    expect(cleanTranscript(undefined)).toBe("");
    expect(cleanTranscript("   ")).toBe("");
  });
});
