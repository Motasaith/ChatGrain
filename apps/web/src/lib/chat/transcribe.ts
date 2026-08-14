import "server-only";

import { logger } from "@/lib/observability/logger";
import { cleanTranscript } from "@/lib/voice/transcript";

export async function transcribeAudio(file: File) {
  const baseUrl = process.env.WHISPER_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) return null;
  const path = process.env.WHISPER_TRANSCRIBE_PATH?.trim() || "/inference";
  const body = new FormData();
  body.append("file", file, file.name || "recording.webm");
  body.append("response_format", "json");
  // See the note in lib/voice/stt.ts: "auto" is a whisper.cpp-ism, and an
  // OpenAI-compatible endpoint needs the model named instead.
  const modelName = process.env.WHISPER_MODEL_NAME?.trim();
  if (modelName) body.append("model", modelName);
  else body.append("language", "auto");
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: process.env.WHISPER_API_KEY?.trim()
        ? { authorization: `Bearer ${process.env.WHISPER_API_KEY.trim()}` }
        : undefined,
      body,
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Whisper transcription request failed",
      );
      return null;
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as {
        text?: string;
        transcription?: string;
      };
      return cleanTranscript(payload.text || payload.transcription) || null;
    }
    return cleanTranscript(await response.text()) || null;
  } catch (error) {
    logger.warn({ error }, "Whisper transcription request failed");
    return null;
  }
}
