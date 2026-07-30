/**
 * Wire protocol for the realtime voice gateway.
 *
 * Control messages travel as JSON text frames; audio travels as binary frames
 * so it never pays base64 overhead.
 *
 * Direction matters for the binary framing:
 * - client -> server is bare 16 kHz mono signed 16-bit little-endian PCM.
 * - server -> client is prefixed with a little-endian uint32 turn id, so the
 *   client can drop synthesized audio belonging to a turn that a barge-in has
 *   already cancelled.
 */

/** Sample rate the client captures at and the gateway feeds to whisper.cpp. */
export const CAPTURE_SAMPLE_RATE = 16_000;

/** Bytes of turn-id header in front of every binary audio frame. */
export const AUDIO_FRAME_HEADER_BYTES = 4;

export type VoiceState = "listening" | "thinking" | "speaking";

export type ClientMessage =
  | {
      type: "start";
      agentId: string;
      sessionId: string;
      conversationId?: string;
      externalUserId?: string;
      embedToken?: string;
      locale?: string;
      /** Page the call was started from, mirrored into conversation metadata. */
      path?: string;
    }
  /** VAD detected the caller started speaking; used for server-side barge-in. */
  | { type: "speech_start" }
  /** VAD detected end of speech: flush buffered audio and transcribe it. */
  | { type: "utterance_end" }
  /** Caller talked over the agent - abandon this turn entirely. */
  | { type: "interrupt"; turnId: number }
  /** Typed fallback so a call still works when the mic fails. */
  | { type: "text"; content: string }
  | { type: "ping" }
  | { type: "stop" };

export type VoiceCitation = {
  chunkId: string;
  title: string;
  url?: string;
  excerpt: string;
};

export type ServerMessage =
  | {
      type: "ready";
      conversationId: string;
      sessionId: string;
      /** False when WHISPER_BASE_URL is unset - client shows a typed fallback. */
      sttEnabled: boolean;
      /** False when PIPER_BASE_URL is unset - client renders text-only replies. */
      ttsEnabled: boolean;
      greeting?: string;
    }
  | { type: "state"; value: VoiceState }
  /** Final recognition of a caller utterance. */
  | { type: "transcript"; turnId: number; text: string }
  /** Incremental agent tokens, so text appears before audio is synthesized. */
  | { type: "answer_delta"; turnId: number; text: string }
  | {
      type: "answer";
      turnId: number;
      text: string;
      grounded: boolean;
      citations: VoiceCitation[];
    }
  | { type: "audio_start"; turnId: number; sampleRate: number }
  | { type: "audio_end"; turnId: number }
  | { type: "cancelled"; turnId: number }
  | { type: "error"; code: string; message: string; fatal?: boolean };

export function encodeAudioFrame(turnId: number, pcm: Uint8Array): Uint8Array {
  const frame = new Uint8Array(AUDIO_FRAME_HEADER_BYTES + pcm.byteLength);
  new DataView(frame.buffer).setUint32(0, turnId, true);
  frame.set(pcm, AUDIO_FRAME_HEADER_BYTES);
  return frame;
}

export function decodeAudioFrame(frame: ArrayBuffer) {
  if (frame.byteLength < AUDIO_FRAME_HEADER_BYTES) return null;
  const turnId = new DataView(frame).getUint32(0, true);
  return {
    turnId,
    pcm: new Uint8Array(frame, AUDIO_FRAME_HEADER_BYTES),
  };
}
