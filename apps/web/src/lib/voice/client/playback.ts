/**
 * Gapless playback queue for streamed PCM.
 *
 * Chunks are scheduled back-to-back on the Web Audio clock rather than handed
 * to an `<audio>` element, for two reasons: an element cannot play a stream
 * that is still being synthesized, and it cannot be silenced instantly. Barge-in
 * needs playback to stop within a frame, so every scheduled source is tracked
 * and stopped explicitly.
 */

/** Scheduling cushion that absorbs network jitter without audible delay. */
const START_LEAD_SECONDS = 0.08;

export class PcmPlayer {
  private context?: AudioContext;
  private gain?: GainNode;
  private sources = new Set<AudioBufferSourceNode>();
  private playhead = 0;
  /** Carries a trailing odd byte so a 16-bit sample is never split. */
  private remainder?: Uint8Array;
  private ended?: () => void;

  constructor(private readonly onLevel?: (level: number) => void) {}

  /** Must be called from a user gesture so the context is allowed to start. */
  async prepare() {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  get isPlaying() {
    return this.sources.size > 0;
  }

  /** Schedules one chunk of signed 16-bit little-endian mono PCM. */
  enqueue(pcm: Uint8Array, sampleRate: number) {
    const context = this.context;
    const gain = this.gain;
    if (!context || !gain) return;

    let bytes = pcm;
    if (this.remainder?.length) {
      const merged = new Uint8Array(this.remainder.length + pcm.length);
      merged.set(this.remainder);
      merged.set(pcm, this.remainder.length);
      bytes = merged;
      this.remainder = undefined;
    }
    if (bytes.length % 2) {
      this.remainder = bytes.slice(bytes.length - 1);
      bytes = bytes.slice(0, bytes.length - 1);
    }
    const sampleCount = bytes.length / 2;
    if (!sampleCount) return;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const buffer = context.createBuffer(1, sampleCount, sampleRate);
    const channel = buffer.getChannelData(0);
    let energy = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = view.getInt16(index * 2, true) / 32768;
      channel[index] = sample;
      energy += sample * sample;
    }
    this.onLevel?.(Math.min(1, Math.sqrt(energy / sampleCount) * 3));

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);

    const startAt = Math.max(
      context.currentTime + START_LEAD_SECONDS,
      this.playhead,
    );
    source.start(startAt);
    this.playhead = startAt + buffer.duration;

    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      if (!this.sources.size) {
        this.onLevel?.(0);
        this.ended?.();
      }
    };
  }

  /** Resolves once every queued chunk has finished playing. */
  waitForDrain() {
    if (!this.sources.size) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.ended = () => {
        this.ended = undefined;
        resolve();
      };
    });
  }

  /** Silences playback immediately and drops everything still queued. */
  stop() {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.sources.clear();
    this.remainder = undefined;
    this.playhead = this.context?.currentTime ?? 0;
    this.onLevel?.(0);
    this.ended?.();
    this.ended = undefined;
  }

  async close() {
    this.stop();
    await this.context?.close().catch(() => undefined);
    this.context = undefined;
    this.gain = undefined;
  }
}
