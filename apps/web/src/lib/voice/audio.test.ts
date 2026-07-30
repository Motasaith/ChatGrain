import { describe, expect, it } from "vitest";

import { pcm16ToWav, pcmDurationMs, pcmRms } from "./audio";

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

describe("pcm16ToWav", () => {
  it("writes a valid 16 kHz mono PCM header", () => {
    const pcm = new Uint8Array(640); // 20 ms
    const wav = pcm16ToWav(pcm, 16_000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(view.getUint32(4, true)).toBe(36 + pcm.byteLength);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000); // byte rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(pcm.byteLength);
    expect(wav.byteLength).toBe(44 + pcm.byteLength);
  });
});

describe("pcmDurationMs", () => {
  it("converts byte length to milliseconds", () => {
    expect(pcmDurationMs(16_000 * 2, 16_000)).toBe(1_000);
    expect(pcmDurationMs(640, 16_000)).toBe(20);
  });
});

describe("pcmRms", () => {
  it("reports zero for silence", () => {
    expect(pcmRms(new Uint8Array(320))).toBe(0);
  });

  it("reports full scale for a saturated buffer", () => {
    const samples = new Int16Array(160).fill(32_767);
    const pcm = new Uint8Array(samples.buffer);
    expect(pcmRms(pcm)).toBeCloseTo(1, 2);
  });
});
