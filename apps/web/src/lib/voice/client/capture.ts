import { EnergyVad } from "@/lib/voice/client/vad";

/**
 * Frames kept before speech onset. The VAD needs ~100 ms of loud audio to make
 * a decision, so without a pre-roll every utterance would lose its first
 * syllable - the classic "ello?" effect.
 */
const PREROLL_FRAMES = 18; // ~360 ms

export type CaptureHandlers = {
  onFrame: (pcm: Uint8Array) => void;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  /** 0..1 microphone level, for the UI meter. */
  onLevel: (level: number) => void;
};

export type MicrophoneCapture = {
  stop: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  /** Suppresses VAD onset while the agent speaks, if echo cancellation fails. */
  setHalfDuplex: (enabled: boolean) => void;
};

export async function startCapture(
  handlers: CaptureHandlers,
  workletUrl = "/voice-capture-worklet.js",
): Promise<MicrophoneCapture> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
    throw new Error("This browser cannot capture microphone audio.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // Echo cancellation is what makes barge-in possible at all: without it
      // the microphone hears the agent's own speech and interrupts itself.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  const context = new AudioContext();
  // Autoplay policies can start the context suspended even after a click.
  if (context.state === "suspended") await context.resume();

  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    throw new Error(
      error instanceof Error && error.message
        ? `Voice capture failed to load: ${error.message}`
        : "Voice capture failed to load.",
    );
  }

  const source = context.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(context, "voice-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
  });

  const vad = new EnergyVad();
  const preroll: Uint8Array[] = [];
  let speaking = false;
  let halfDuplex = false;
  let muted = false;
  let stopped = false;

  worklet.port.onmessage = (event: MessageEvent) => {
    const data = event.data as
      | { type: "frame"; pcm: ArrayBuffer; rms: number; peak: number }
      | undefined;
    if (!data || data.type !== "frame" || stopped) return;

    const pcm = new Uint8Array(data.pcm);
    handlers.onLevel(Math.min(1, data.peak));

    if (muted) return;

    const decision = vad.push(data.rms);

    if (!speaking) {
      preroll.push(pcm);
      if (preroll.length > PREROLL_FRAMES) preroll.shift();
    }

    if (decision === "speech_start") {
      // While the agent is talking and echo cancellation is unavailable, treat
      // the mic as closed rather than letting the agent interrupt itself.
      if (halfDuplex) {
        vad.reset();
        return;
      }
      speaking = true;
      handlers.onSpeechStart();
      for (const frame of preroll) handlers.onFrame(frame);
      preroll.length = 0;
      return;
    }

    if (speaking) {
      handlers.onFrame(pcm);
      if (decision === "speech_end") {
        speaking = false;
        handlers.onSpeechEnd();
      }
    }
  };

  source.connect(worklet);

  return {
    async stop() {
      stopped = true;
      worklet.port.onmessage = null;
      try {
        source.disconnect();
        worklet.disconnect();
      } catch {
        // Already torn down.
      }
      stream.getTracks().forEach((track) => track.stop());
      await context.close().catch(() => undefined);
    },
    setMuted(value: boolean) {
      muted = value;
      worklet.port.postMessage({ type: "mute", value });
      if (value && speaking) {
        speaking = false;
        vad.reset();
        handlers.onSpeechEnd();
      }
    },
    setHalfDuplex(value: boolean) {
      halfDuplex = value;
    },
  };
}
