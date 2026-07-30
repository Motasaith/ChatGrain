import { describe, expect, it } from "vitest";

import { formatDuration, waveformPeaks } from "./voice-note";

describe("formatDuration", () => {
  it("formats seconds as minutes and padded seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("never renders a broken duration for missing metadata", () => {
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatDuration(-4)).toBe("0:00");
  });
});

describe("waveformPeaks", () => {
  it("returns the requested number of bars", () => {
    const samples = new Float32Array(5_000).map((_, index) =>
      Math.sin(index / 12),
    );
    expect(waveformPeaks(samples, 24)).toHaveLength(24);
  });

  it("normalizes so a quiet recording still shows a shape", () => {
    const quiet = new Float32Array(1_000).fill(0.02);
    const peaks = waveformPeaks(quiet, 10);
    expect(Math.max(...peaks)).toBeCloseTo(1, 5);
  });

  it("tracks where the audio is loud", () => {
    const samples = new Float32Array(1_000);
    // Only the final quarter carries signal.
    samples.fill(0.9, 750);
    const peaks = waveformPeaks(samples, 4);
    expect(peaks[0]).toBe(0);
    expect(peaks[3]).toBeCloseTo(1, 5);
  });

  it("handles empty audio without dividing by zero", () => {
    expect(waveformPeaks(new Float32Array(0), 6)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
