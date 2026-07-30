import { startCapture, type MicrophoneCapture } from "@/lib/voice/client/capture";
import { PcmPlayer } from "@/lib/voice/client/playback";
import {
  decodeAudioFrame,
  type ClientMessage,
  type ServerMessage,
  type VoiceCitation,
} from "@/lib/voice/protocol";

export type CallStatus =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "ended";

export type CallHandlers = {
  onStatus: (status: CallStatus) => void;
  onReady: (info: { sttEnabled: boolean; ttsEnabled: boolean }) => void;
  /** Final recognition of something the caller said. */
  onUserTurn: (text: string) => void;
  /** Streamed agent text, appended as it arrives. */
  onAgentDelta: (turnId: number, text: string) => void;
  /** Authoritative agent turn; replaces accumulated deltas. */
  onAgentTurn: (turn: {
    turnId: number;
    text: string;
    grounded: boolean;
    citations: VoiceCitation[];
  }) => void;
  onCancelled: (turnId: number) => void;
  onMicLevel: (level: number) => void;
  onAgentLevel: (level: number) => void;
  onError: (message: string, fatal: boolean) => void;
};

export type StartCallOptions = {
  agentId: string;
  sessionId: string;
  conversationId?: string;
  externalUserId?: string;
  embedToken?: string;
  locale?: string;
  path?: string;
};

export function voiceSocketUrl() {
  const configured = process.env.NEXT_PUBLIC_VOICE_WS_URL?.trim();
  if (configured) return configured;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const port = process.env.NEXT_PUBLIC_VOICE_WS_PORT?.trim() || "3002";
  return `${protocol}//${window.location.hostname}:${port}/voice`;
}

export class VoiceCall {
  private socket?: WebSocket;
  private capture?: MicrophoneCapture;
  private readonly player: PcmPlayer;
  private audioTurn = 0;
  private audioSampleRate = 24_000;
  private conversationId?: string;
  private ttsAvailable = true;
  private ending = false;

  constructor(private readonly handlers: CallHandlers) {
    this.player = new PcmPlayer((level) => handlers.onAgentLevel(level));
  }

  get activeConversationId() {
    return this.conversationId;
  }

  async start(options: StartCallOptions) {
    this.handlers.onStatus("connecting");
    // Prepared inside the click handler that opened the call, so the browser
    // accepts the audio context as user-initiated.
    await this.player.prepare();

    const socket = new WebSocket(voiceSocketUrl());
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      this.send({
        type: "start",
        agentId: options.agentId,
        sessionId: options.sessionId,
        conversationId: options.conversationId,
        externalUserId: options.externalUserId,
        embedToken: options.embedToken,
        locale: options.locale,
        path: options.path,
      });
    };

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.handleAudio(event.data);
        return;
      }
      try {
        this.handleMessage(JSON.parse(event.data as string) as ServerMessage);
      } catch {
        // Ignore frames that are not valid protocol messages.
      }
    };

    socket.onerror = () => {
      if (!this.ending) {
        this.handlers.onError("Lost connection to the voice service.", true);
      }
    };

    socket.onclose = () => {
      if (!this.ending) this.handlers.onStatus("ended");
      void this.teardownAudio();
    };
  }

  private handleAudio(frame: ArrayBuffer) {
    const decoded = decodeAudioFrame(frame);
    // Audio from a turn the caller already interrupted must never be played.
    if (!decoded || decoded.turnId !== this.audioTurn) return;
    this.player.enqueue(decoded.pcm, this.audioSampleRate);
  }

  private handleMessage(message: ServerMessage) {
    switch (message.type) {
      case "ready":
        this.conversationId = message.conversationId;
        this.ttsAvailable = message.ttsEnabled;
        this.handlers.onReady({
          sttEnabled: message.sttEnabled,
          ttsEnabled: message.ttsEnabled,
        });
        void this.openMicrophone(message.sttEnabled);
        break;
      case "state":
        this.handlers.onStatus(message.value);
        // Without echo cancellation the mic would trigger on the agent's own
        // voice; half duplex is the safety net while it speaks.
        this.capture?.setHalfDuplex(
          message.value === "speaking" && !this.ttsAvailable,
        );
        break;
      case "transcript":
        this.handlers.onUserTurn(message.text);
        break;
      case "answer_delta":
        this.handlers.onAgentDelta(message.turnId, message.text);
        break;
      case "answer":
        this.handlers.onAgentTurn({
          turnId: message.turnId,
          text: message.text,
          grounded: message.grounded,
          citations: message.citations,
        });
        break;
      case "audio_start":
        this.audioTurn = message.turnId;
        this.audioSampleRate = message.sampleRate;
        break;
      case "audio_end":
        break;
      case "cancelled":
        this.player.stop();
        this.handlers.onCancelled(message.turnId);
        break;
      case "error":
        this.handlers.onError(message.message, Boolean(message.fatal));
        if (message.fatal) void this.hangUp();
        break;
      default:
        break;
    }
  }

  private async openMicrophone(sttAvailable: boolean) {
    if (!sttAvailable || this.capture) return;
    try {
      this.capture = await startCapture({
        onFrame: (pcm) => {
          if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(pcm);
          }
        },
        onSpeechStart: () => {
          // Barge-in: cut the agent off locally first so it goes quiet
          // immediately, then tell the server to abandon the turn.
          if (this.player.isPlaying) {
            this.player.stop();
            this.send({ type: "interrupt", turnId: this.audioTurn });
          }
          this.send({ type: "speech_start" });
        },
        onSpeechEnd: () => this.send({ type: "utterance_end" }),
        onLevel: (level) => this.handlers.onMicLevel(level),
      });
    } catch (error) {
      this.handlers.onError(
        error instanceof Error
          ? error.message
          : "Microphone access was denied or is unavailable.",
        false,
      );
    }
  }

  setMuted(muted: boolean) {
    this.capture?.setMuted(muted);
  }

  sendText(content: string) {
    const text = content.trim();
    if (!text) return;
    this.player.stop();
    this.send({ type: "interrupt", turnId: this.audioTurn });
    this.send({ type: "text", content: text });
  }

  async hangUp() {
    if (this.ending) return;
    this.ending = true;
    this.send({ type: "stop" });
    await this.teardownAudio();
    this.socket?.close(1000, "hang_up");
    this.socket = undefined;
    this.handlers.onStatus("ended");
  }

  private async teardownAudio() {
    const capture = this.capture;
    this.capture = undefined;
    await capture?.stop().catch(() => undefined);
    await this.player.close().catch(() => undefined);
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }
}
