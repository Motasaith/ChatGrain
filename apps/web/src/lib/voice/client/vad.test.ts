import { describe, expect, it } from "vitest";

import { EnergyVad } from "./vad";

function feed(vad: EnergyVad, rms: number, frames: number) {
  const events: Array<string | null> = [];
  for (let index = 0; index < frames; index += 1) events.push(vad.push(rms));
  return events.filter(Boolean);
}

describe("EnergyVad", () => {
  it("stays silent through room noise", () => {
    const vad = new EnergyVad();
    expect(feed(vad, 0.002, 200)).toEqual([]);
    expect(vad.isSpeaking).toBe(false);
  });

  it("detects speech onset then end after the hangover", () => {
    const vad = new EnergyVad({ onsetFrames: 3, hangoverFrames: 10 });
    feed(vad, 0.002, 60); // settle the noise floor

    expect(feed(vad, 0.2, 3)).toEqual(["speech_start"]);
    expect(vad.isSpeaking).toBe(true);

    // A short pause mid-sentence must not end the utterance.
    expect(feed(vad, 0.001, 9)).toEqual([]);
    expect(vad.isSpeaking).toBe(true);

    feed(vad, 0.2, 3);
    expect(feed(vad, 0.001, 10)).toEqual(["speech_end"]);
    expect(vad.isSpeaking).toBe(false);
  });

  it("raises its threshold to track a noisier room", () => {
    const quiet = new EnergyVad();
    feed(quiet, 0.001, 200);

    const noisy = new EnergyVad();
    // Background loud enough to matter but still under the opening threshold,
    // which is the range an energy detector can actually adapt to.
    feed(noisy, 0.01, 200);

    expect(noisy.threshold).toBeGreaterThan(quiet.threshold);
  });

  it("ends an utterance that steady noise would otherwise hold open", () => {
    const vad = new EnergyVad({ onsetFrames: 3, maxSpeechFrames: 20 });
    feed(vad, 0.002, 60);

    expect(feed(vad, 0.4, 3)).toEqual(["speech_start"]);
    // Level never drops, so only the ceiling can close the utterance.
    expect(feed(vad, 0.4, 20)).toEqual(["speech_end"]);
    expect(vad.isSpeaking).toBe(false);
  });

  it("does not raise the noise floor while the caller is speaking", () => {
    const vad = new EnergyVad({ onsetFrames: 3 });
    feed(vad, 0.002, 60);
    const before = vad.threshold;
    feed(vad, 0.4, 40);
    expect(vad.threshold).toBe(before);
  });
});
