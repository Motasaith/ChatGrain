// No `server-only` marker here on purpose: this module is imported by the
// standalone voice gateway process, where that package throws because the
// `react-server` export condition is absent.
import { logger } from "@/lib/observability/logger";

/**
 * Fallback sample rate, used only when the speech server does not declare one.
 *
 * OpenAI's own service emits 24 kHz, but self-hosted Piper voices follow the
 * model: the common libritts and northern_english voices are 22.05 kHz. Playing
 * back at the wrong rate shifts pitch and tempo, so the rate declared on the
 * response always wins over this value.
 */
export function ttsSampleRate() {
  const configured = Number(process.env.TTS_SAMPLE_RATE?.trim());
  return Number.isFinite(configured) && configured > 0 ? configured : 22_050;
}

/** Reads `audio/pcm;rate=22050` style content types. */
export function parsePcmSampleRate(contentType: string | null) {
  const match = /rate=(\d+)/i.exec(contentType || "");
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function ttsBaseUrl() {
  return process.env.TTS_BASE_URL?.trim().replace(/\/+$/, "") || "";
}

export function ttsEnabled() {
  return Boolean(ttsBaseUrl());
}

/**
 * Strips anything that a speech engine would read aloud as punctuation noise.
 * Without this the agent literally says "open bracket one close bracket" for
 * citations and "asterisk asterisk" for bold text.
 */
export function speakableText(value: string) {
  return (
    value
      // Fenced code is unspeakable; drop it rather than reading symbols.
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      // Markdown links: keep the label, drop the URL.
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
      // Citation markers such as [1] or [1, 2], with the space in front of
      // them, so removal never strands a gap before the sentence's period.
      .replace(/\s*\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, "")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, "$1$2")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      // Bare URLs read terribly; name the destination instead.
      .replace(/https?:\/\/\S+/g, "the link on screen")
      .replace(/[ \t]+/g, " ")
      // Stripping inline markup can leave a gap before punctuation, which
      // speech engines render as an audible stumble.
      .replace(/ +([,.;:!?])/g, "$1")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

/** Sentence terminator followed by whitespace, or a hard line break. */
const SENTENCE_BOUNDARY = /([.!?…])(\s+)|(\n+)/;

/** Abbreviations that must not be mistaken for a sentence end. */
const ABBREVIATION = /(?:^|\s)(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|approx|fig|no)\.$/i;

/**
 * Accumulates streamed LLM text and releases it in speakable chunks.
 *
 * The first chunk is deliberately released early - a short lead-in gets audio
 * playing while the model is still generating, which is what makes the call
 * feel responsive instead of laggy.
 */
export class SpeechChunker {
  private buffer = "";
  private released = 0;

  constructor(
    private readonly firstChunkChars = 60,
    private readonly maxChunkChars = 240,
  ) {}

  push(delta: string): string[] {
    this.buffer += delta;
    const chunks: string[] = [];
    let chunk = this.take();
    while (chunk) {
      chunks.push(chunk);
      chunk = this.take();
    }
    return chunks;
  }

  /** Releases whatever is left once the model stops generating. */
  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return null;
    this.released += 1;
    return rest;
  }

  private take(): string | null {
    // The first chunk breaks earlier than the rest, because time-to-first-audio
    // is what the caller actually perceives as latency.
    const maxChars =
      this.released === 0 ? this.firstChunkChars : this.maxChunkChars;
    let searchFrom = 0;

    // Every complete sentence is released, however short. "Sure." synthesizes
    // fine and getting it out early is exactly what keeps the call snappy.
    while (searchFrom < this.buffer.length) {
      const match = SENTENCE_BOUNDARY.exec(this.buffer.slice(searchFrom));
      if (!match) break;
      const boundaryEnd = searchFrom + match.index + match[0].length;
      const candidate = this.buffer.slice(0, boundaryEnd);
      const trimmed = candidate.trim();
      if (!trimmed || ABBREVIATION.test(candidate.trimEnd())) {
        searchFrom = boundaryEnd;
        continue;
      }
      this.buffer = this.buffer.slice(boundaryEnd);
      this.released += 1;
      return trimmed;
    }

    // No usable sentence end, but the buffer has outgrown a comfortable chunk:
    // break at the last comma or space so synthesis can start anyway.
    if (this.buffer.length > maxChars) {
      const window = this.buffer.slice(0, maxChars);
      const soft = Math.max(window.lastIndexOf(", "), window.lastIndexOf(" "));
      const cut = soft > maxChars * 0.5 ? soft + 1 : maxChars;
      const candidate = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      this.released += 1;
      return candidate;
    }

    return null;
  }
}

export type SpeechChunk = {
  pcm: Uint8Array;
  /** Rate declared by the server for this response, not a configured guess. */
  sampleRate: number;
};

/**
 * Streams synthesized PCM for one chunk of text. Chunks are yielded as they
 * arrive so playback can begin before synthesis finishes.
 */
export async function* synthesizeSpeech(
  text: string,
  { signal }: { signal?: AbortSignal } = {},
): AsyncGenerator<SpeechChunk> {
  const baseUrl = ttsBaseUrl();
  const spoken = speakableText(text);
  if (!baseUrl || !spoken) return;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.TTS_API_KEY?.trim()
          ? { authorization: `Bearer ${process.env.TTS_API_KEY.trim()}` }
          : {}),
      },
      body: JSON.stringify({
        model: process.env.TTS_MODEL?.trim() || "tts-1",
        voice: process.env.TTS_VOICE?.trim() || "alloy",
        speed: Number(process.env.TTS_SPEED?.trim()) || 1,
        response_format: "pcm",
        input: spoken,
      }),
      signal,
    });
  } catch (error) {
    if (!signal?.aborted) logger.warn({ error }, "Speech synthesis request failed");
    return;
  }

  if (!response.ok || !response.body) {
    logger.warn({ status: response.status }, "Speech synthesis request failed");
    return;
  }

  const sampleRate =
    parsePcmSampleRate(response.headers.get("content-type")) ?? ttsSampleRate();

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) yield { pcm: value, sampleRate };
    }
  } catch (error) {
    if (!signal?.aborted) logger.warn({ error }, "Speech synthesis stream failed");
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
