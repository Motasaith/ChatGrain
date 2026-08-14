// No `server-only` marker here on purpose: this module is imported by the
// standalone voice gateway process, where that package throws because the
// `react-server` export condition is absent.
import { logger } from "@/lib/observability/logger";
import { float32ToPcm16 } from "@/lib/voice/audio";

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

/**
 * Kokoro-82M in this process, via `kokoro-js`.
 *
 * The alternative is running Kokoro-FastAPI as a separate server, which means
 * either a container or a Python process to supervise. Neither is worth it when
 * the model is 82M parameters and the ONNX runtime is already loaded for
 * embeddings - this keeps text-to-speech a library call with nothing to deploy.
 */
export function ttsLocal() {
  return (process.env.TTS_PROVIDER?.trim() || "local") === "local";
}

export function ttsEnabled() {
  return ttsLocal() ? true : Boolean(ttsBaseUrl());
}

const KOKORO_SAMPLE_RATE = 24_000;

type KokoroAudio = { audio: Float32Array; sampling_rate: number };

type KokoroModel = {
  stream(
    text: unknown,
    options: { voice?: string; speed?: number },
  ): AsyncGenerator<{ audio: KokoroAudio }>;
};

type SplitterStream = {
  push(...text: string[]): void;
  close(): void;
};

let kokoroPromise: Promise<KokoroModel> | undefined;

let splitterFactory: (() => SplitterStream) | undefined;

async function loadKokoro() {
  if (!kokoroPromise) {
    kokoroPromise = import("kokoro-js").then(
      async ({ KokoroTTS, TextSplitterStream }) => {
        splitterFactory = () =>
          new TextSplitterStream() as unknown as SplitterStream;
        const model = await KokoroTTS.from_pretrained(
          process.env.TTS_MODEL_ID?.trim() ||
            "onnx-community/Kokoro-82M-v1.0-ONNX",
          {
            dtype: (process.env.TTS_DTYPE?.trim() || "q8") as "q8",
            device: "cpu",
          },
        );
        logger.info("Kokoro speech model loaded");
        return model as unknown as KokoroModel;
      },
    );
    // A failed load must not poison every later attempt with the same rejection.
    kokoroPromise.catch(() => {
      kokoroPromise = undefined;
    });
  }
  return kokoroPromise;
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
/**
 * Yields one chunk per sentence, as the model finishes it, so playback starts
 * on the first sentence rather than after the whole answer is synthesized.
 */
async function* synthesizeLocally(
  spoken: string,
  signal?: AbortSignal,
): AsyncGenerator<SpeechChunk> {
  let model: KokoroModel;
  try {
    model = await loadKokoro();
  } catch (error) {
    logger.warn({ error }, "Kokoro speech model unavailable");
    return;
  }
  const speed = Number(process.env.TTS_SPEED?.trim()) || 1;
  const voice = process.env.TTS_VOICE?.trim() || "af_bella";

  // Drive the splitter ourselves rather than passing a bare string.
  //
  // kokoro-js 1.2.1's string path builds a TextSplitterStream internally and
  // pushes the text but never closes it. Its iterator only stops once closed,
  // so after the buffered sentences drain it awaits a promise nobody resolves
  // and the generator hangs forever - and the trailing partial sentence, which
  // only `close()` flushes, is never spoken at all. Closing it ourselves fixes
  // both, and still yields per sentence so playback starts on the first one.
  const splitter = splitterFactory?.();
  if (!splitter) return;
  splitter.push(spoken);
  splitter.close();

  try {
    for await (const { audio } of model.stream(splitter, { voice, speed })) {
      if (signal?.aborted) return;
      yield {
        pcm: float32ToPcm16(audio.audio),
        // Trust what the model reports; only fall back if it says nothing.
        sampleRate: audio.sampling_rate || KOKORO_SAMPLE_RATE,
      };
    }
  } catch (error) {
    if (!signal?.aborted) logger.warn({ error }, "Kokoro synthesis failed");
  }
}

export async function* synthesizeSpeech(
  text: string,
  { signal }: { signal?: AbortSignal } = {},
): AsyncGenerator<SpeechChunk> {
  const spoken = speakableText(text);
  if (!spoken) return;
  if (ttsLocal()) {
    yield* synthesizeLocally(spoken, signal);
    return;
  }
  const baseUrl = ttsBaseUrl();
  if (!baseUrl) return;

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
