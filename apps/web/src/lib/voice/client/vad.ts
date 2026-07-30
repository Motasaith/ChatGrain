/**
 * Adaptive energy voice-activity detection over 20 ms frames.
 *
 * The threshold tracks the room's noise floor instead of using a fixed level,
 * so the same settings work in a quiet room and on a noisy street. Hysteresis
 * (a run of loud frames to open, a longer run of quiet frames to close) stops
 * a single consonant or a brief pause from chopping an utterance in half.
 */

export type VadEvent = "speech_start" | "speech_end";

export type VadOptions = {
  /** Consecutive loud frames required to declare speech. */
  onsetFrames?: number;
  /** Consecutive quiet frames required to declare the utterance finished. */
  hangoverFrames?: number;
  /** How far above the noise floor a frame must be to count as speech. */
  thresholdRatio?: number;
  /** Absolute level below which audio is always treated as silence. */
  floor?: number;
  /** Forces the utterance to end after this many continuous speech frames. */
  maxSpeechFrames?: number;
};

const DEFAULTS = {
  onsetFrames: 5, // 100 ms
  hangoverFrames: 38, // ~760 ms, long enough to survive a thinking pause
  thresholdRatio: 3.2,
  floor: 0.004,
  // Steady loud noise (a fan, a busy street) reads as speech to any energy
  // detector. Without a ceiling the utterance would never end and the caller
  // could never complete a turn, so cut it off at 30 seconds.
  maxSpeechFrames: 1_500,
};

export class EnergyVad {
  private readonly options: Required<VadOptions>;
  private noiseFloor: number;
  private speaking = false;
  private loudRun = 0;
  private quietRun = 0;
  private frames = 0;
  private speechRun = 0;

  constructor(options: VadOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.noiseFloor = this.options.floor;
  }

  get isSpeaking() {
    return this.speaking;
  }

  /** Current decision threshold, useful for driving a level meter. */
  get threshold() {
    return Math.max(this.noiseFloor * this.options.thresholdRatio, this.options.floor);
  }

  reset() {
    this.speaking = false;
    this.loudRun = 0;
    this.quietRun = 0;
    this.speechRun = 0;
  }

  push(rms: number): VadEvent | null {
    this.frames += 1;
    const loud = rms > this.threshold;

    // Adapt only on silence, and only after a short warm-up, so the floor never
    // creeps up to swallow the caller's own voice.
    if (!this.speaking && !loud) {
      const weight = this.frames < 25 ? 0.2 : 0.03;
      this.noiseFloor = this.noiseFloor * (1 - weight) + rms * weight;
      if (this.noiseFloor < this.options.floor) this.noiseFloor = this.options.floor;
    }

    if (loud) {
      this.loudRun += 1;
      this.quietRun = 0;
    } else {
      this.quietRun += 1;
      this.loudRun = 0;
    }

    if (!this.speaking && this.loudRun >= this.options.onsetFrames) {
      this.speaking = true;
      this.quietRun = 0;
      this.speechRun = 0;
      return "speech_start";
    }
    if (this.speaking) {
      this.speechRun += 1;
      const tooLong = this.speechRun >= this.options.maxSpeechFrames;
      if (tooLong || this.quietRun >= this.options.hangoverFrames) {
        this.speaking = false;
        this.loudRun = 0;
        this.speechRun = 0;
        // A forced cut means the level never dropped, so the "silence" the
        // floor was tracking is gone; re-seed it from what is actually there.
        if (tooLong) this.noiseFloor = Math.max(this.options.floor, rms * 0.9);
        return "speech_end";
      }
    }
    return null;
  }
}
