/**
 * Capture worklet for Docent voice calls.
 *
 * Runs on the audio render thread and converts the microphone stream into the
 * 16 kHz mono signed 16-bit PCM the gateway feeds to whisper.cpp. Resampling
 * here (rather than on the main thread) keeps capture glitch-free while React
 * is busy rendering.
 */

const TARGET_SAMPLE_RATE = 16000;

/** ~20 ms of audio at the target rate, the usual VAD frame size. */
const FRAME_SAMPLES = 320;

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_SAMPLE_RATE;
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.frameIndex = 0;
    // Fractional read position into the incoming block, carried across blocks
    // so no sample is dropped or duplicated at block boundaries.
    this.readOffset = 0;
    this.muted = false;

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "mute") {
        this.muted = Boolean(event.data.value);
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    // Average the channels so a stereo mic does not halve perceived level.
    const channels = input.length;
    const samples = input[0].length;
    let position = this.readOffset;

    while (position < samples) {
      const index = Math.floor(position);
      // Box-average across the source window feeding this output sample. This
      // is a cheap anti-aliasing filter; plain decimation would fold high
      // frequencies down into the speech band and hurt recognition.
      const windowEnd = Math.min(samples, Math.floor(position + this.ratio));
      let sum = 0;
      let count = 0;
      for (let source = index; source < Math.max(windowEnd, index + 1); source += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          const data = input[channel];
          if (data && source < data.length) {
            sum += data[source];
            count += 1;
          }
        }
      }
      const value = count ? sum / count : 0;
      const clamped = value > 1 ? 1 : value < -1 ? -1 : value;
      this.frame[this.frameIndex] = this.muted
        ? 0
        : Math.round(clamped * 32767);
      this.frameIndex += 1;

      if (this.frameIndex === FRAME_SAMPLES) {
        let peak = 0;
        let energy = 0;
        for (let i = 0; i < FRAME_SAMPLES; i += 1) {
          const sample = this.frame[i] / 32768;
          energy += sample * sample;
          const magnitude = sample < 0 ? -sample : sample;
          if (magnitude > peak) peak = magnitude;
        }
        const copy = new Int16Array(this.frame);
        this.port.postMessage(
          {
            type: "frame",
            pcm: copy.buffer,
            rms: Math.sqrt(energy / FRAME_SAMPLES),
            peak,
          },
          [copy.buffer],
        );
        this.frameIndex = 0;
      }

      position += this.ratio;
    }

    this.readOffset = position - samples;
    return true;
  }
}

registerProcessor("voice-capture", VoiceCaptureProcessor);
