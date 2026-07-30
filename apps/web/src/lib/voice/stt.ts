// No `server-only` marker here on purpose: this module is imported by the
// standalone voice gateway process, where that package throws because the
// `react-server` export condition is absent.
import { logger } from "@/lib/observability/logger";
import { pcm16ToWav, pcmRms } from "@/lib/voice/audio";
import { CAPTURE_SAMPLE_RATE } from "@/lib/voice/protocol";

/** Utterances quieter than this are treated as room noise, never transcribed. */
const SILENCE_RMS = 0.006;

/** Below this the buffer is too short to contain a word. */
const MIN_UTTERANCE_MS = 220;

/**
 * whisper.cpp emits bracketed markers such as `[BLANK_AUDIO]` or `(silence)`
 * when handed near-silence. Those must never become a caller turn.
 */
const NOISE_ONLY = /^[\s]*[[(][^\])]*[\])][\s]*$/;

export function whisperBaseUrl() {
  return process.env.WHISPER_BASE_URL?.trim().replace(/\/+$/, "") || "";
}

export function sttEnabled() {
  return Boolean(whisperBaseUrl());
}

function cleanTranscript(value: string) {
  const text = value.trim();
  if (!text || NOISE_ONLY.test(text)) return "";
  // Strip leading markers whisper sometimes prepends to real speech.
  return text.replace(/^(?:[[(][^\])]*[\])]\s*)+/, "").trim();
}

/**
 * Transcribes one VAD-endpointed utterance of 16 kHz mono PCM.
 *
 * `partial` requests a faster, lower-quality pass for interim display: it skips
 * the whisper context carry-over so a mid-utterance call cannot poison the
 * final transcription.
 */
export async function transcribeUtterance(
  pcm: Uint8Array,
  {
    language,
    partial = false,
    signal,
  }: { language?: string; partial?: boolean; signal?: AbortSignal } = {},
) {
  const baseUrl = whisperBaseUrl();
  if (!baseUrl) return "";

  const durationMs = (pcm.byteLength / 2 / CAPTURE_SAMPLE_RATE) * 1_000;
  if (durationMs < MIN_UTTERANCE_MS) return "";
  if (pcmRms(pcm) < SILENCE_RMS) return "";

  const path = process.env.WHISPER_TRANSCRIBE_PATH?.trim() || "/inference";
  const wav = pcm16ToWav(pcm, CAPTURE_SAMPLE_RATE);
  const body = new FormData();
  body.append(
    "file",
    new Blob([wav as unknown as BlobPart], { type: "audio/wav" }),
    "utterance.wav",
  );
  body.append("response_format", "json");
  body.append("language", language?.trim() || "auto");
  body.append("temperature", "0");
  // Each utterance is independent; carrying context across turns is a common
  // source of whisper repeating the previous sentence back.
  body.append("no_context", "true");

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: process.env.WHISPER_API_KEY?.trim()
        ? { authorization: `Bearer ${process.env.WHISPER_API_KEY.trim()}` }
        : undefined,
      body,
      signal:
        signal ?? AbortSignal.timeout(partial ? 4_000 : 30_000),
    });
    if (!response.ok) {
      logger.warn(
        { status: response.status, partial },
        "Voice transcription request failed",
      );
      return "";
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as {
        text?: string;
        transcription?: string;
      };
      return cleanTranscript(payload.text || payload.transcription || "");
    }
    return cleanTranscript(await response.text());
  } catch (error) {
    if (signal?.aborted) return "";
    logger.warn({ error, partial }, "Voice transcription request failed");
    return "";
  }
}
