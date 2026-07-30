import { describe, expect, it } from "vitest";

import { decodeAudioFrame, encodeAudioFrame } from "./protocol";

describe("audio framing", () => {
  it("round-trips a turn id and payload", () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 250]);
    const frame = encodeAudioFrame(7, pcm);
    const decoded = decodeAudioFrame(
      frame.buffer.slice(
        frame.byteOffset,
        frame.byteOffset + frame.byteLength,
      ) as ArrayBuffer,
    );

    expect(decoded?.turnId).toBe(7);
    expect(Array.from(decoded?.pcm ?? [])).toEqual([1, 2, 3, 4, 250]);
  });

  it("survives turn ids beyond a signed 16-bit range", () => {
    const frame = encodeAudioFrame(70_000, new Uint8Array([9]));
    const decoded = decodeAudioFrame(
      frame.buffer.slice(
        frame.byteOffset,
        frame.byteOffset + frame.byteLength,
      ) as ArrayBuffer,
    );
    expect(decoded?.turnId).toBe(70_000);
  });

  it("rejects a frame too short to hold a header", () => {
    expect(decodeAudioFrame(new ArrayBuffer(2))).toBeNull();
  });
});
