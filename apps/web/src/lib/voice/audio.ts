import { CAPTURE_SAMPLE_RATE } from "@/lib/voice/protocol";

const WAV_HEADER_BYTES = 44;

/**
 * Wraps raw 16-bit mono PCM in a WAV container. whisper.cpp's server accepts
 * bare PCM only with `--convert` and a matching rate, so sending a real header
 * keeps the transcribe call correct regardless of how the server was started.
 */
export function pcm16ToWav(
  pcm: Uint8Array,
  sampleRate = CAPTURE_SAMPLE_RATE,
) {
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(buffer);
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM subchunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.byteLength, true);

  new Uint8Array(buffer, WAV_HEADER_BYTES).set(pcm);
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

/** Duration in milliseconds of a 16-bit mono PCM buffer. */
export function pcmDurationMs(
  byteLength: number,
  sampleRate = CAPTURE_SAMPLE_RATE,
) {
  return Math.round((byteLength / 2 / sampleRate) * 1_000);
}

/**
 * Root-mean-square level of 16-bit PCM, normalized to 0..1. Used as a cheap
 * server-side guard so near-silent utterances never reach the transcriber.
 */
export function pcmRms(pcm: Uint8Array) {
  const samples = Math.floor(pcm.byteLength / 2);
  if (!samples) return 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let sum = 0;
  for (let index = 0; index < samples; index += 1) {
    const sample = view.getInt16(index * 2, true) / 32_768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}
