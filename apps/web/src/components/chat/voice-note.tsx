"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Mic, Pause, Play, Send, Trash2 } from "lucide-react";

/** Bars drawn in a voice note waveform. */
const WAVEFORM_BARS = 38;

/**
 * One AudioContext shared by every player on the page.
 *
 * Browsers cap concurrent AudioContexts at roughly six, so creating one per
 * voice note means that in a longer conversation the later notes silently fail
 * to decode and fall back to a flat waveform. Decoding is short-lived, so a
 * single shared context serves all of them.
 */
let decodeContext: AudioContext | undefined;

function sharedDecodeContext() {
  if (typeof window === "undefined") return undefined;
  if (!decodeContext || decodeContext.state === "closed") {
    decodeContext = new AudioContext();
  }
  return decodeContext;
}

/**
 * Deterministic stand-in shape used until the audio decodes, and permanently if
 * decoding is unsupported for the recorded container. A varied outline reads as
 * a voice note; a row of equal bars looks like a rendering failure.
 */
function placeholderPeaks(bars = WAVEFORM_BARS) {
  return Array.from({ length: bars }, (_, index) => {
    const wave =
      Math.sin(index * 0.7) * 0.28 +
      Math.sin(index * 1.9 + 1.2) * 0.18 +
      Math.sin(index * 0.31 + 0.6) * 0.2;
    return Math.min(1, Math.max(0.18, 0.5 + wave));
  });
}

/** Playback speeds cycled by the speed button. */
const SPEEDS = [1, 1.5, 2] as const;

export function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Reduces decoded audio to a fixed number of peak values in 0..1.
 *
 * Peaks rather than averages: averaging washes speech into a flat ribbon,
 * while peaks keep the syllable shape that makes a voice note readable at a
 * glance.
 */
export function waveformPeaks(samples: Float32Array, bars = WAVEFORM_BARS) {
  const peaks = new Array<number>(bars).fill(0);
  if (!samples.length) return peaks;
  const perBar = samples.length / bars;
  let highest = 0;
  for (let bar = 0; bar < bars; bar += 1) {
    const start = Math.floor(bar * perBar);
    const end = Math.min(samples.length, Math.floor((bar + 1) * perBar));
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = samples[index] < 0 ? -samples[index] : samples[index];
      if (value > peak) peak = value;
    }
    peaks[bar] = peak;
    if (peak > highest) highest = peak;
  }
  // Normalize so quiet recordings still render a readable shape.
  return highest > 0 ? peaks.map((peak) => peak / highest) : peaks;
}

function Waveform({
  peaks,
  progress,
  onSeek,
}: {
  peaks: number[];
  progress: number;
  onSeek?: (ratio: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const seekTo = useCallback(
    (clientX: number) => {
      const element = trackRef.current;
      if (!element || !onSeek) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width) return;
      onSeek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
    },
    [onSeek],
  );

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onSeek) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekTo(event.clientX);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onSeek || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    seekTo(event.clientX);
  }

  return (
    <div
      className={`voice-note-wave${onSeek ? " is-seekable" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      ref={trackRef}
      role={onSeek ? "slider" : undefined}
      aria-label={onSeek ? "Seek within voice message" : undefined}
      aria-valuemin={onSeek ? 0 : undefined}
      aria-valuemax={onSeek ? 100 : undefined}
      aria-valuenow={onSeek ? Math.round(progress * 100) : undefined}
      style={{ "--wave-progress": progress } as CSSProperties}
    >
      <span className="voice-note-bars" aria-hidden>
        {peaks.map((peak, index) => (
          <span
            key={index}
            className={index / peaks.length < progress ? "is-played" : ""}
            // A floor keeps silent passages visible as a thin line rather than
            // leaving gaps in the waveform.
            style={{ height: `${Math.max(14, Math.round(peak * 100))}%` }}
          />
        ))}
      </span>
      {/* Explicit handle: it shows position at a glance and makes the track
          look draggable, which bars alone do not. */}
      {onSeek ? <span className="voice-note-thumb" aria-hidden /> : null}
    </div>
  );
}

/**
 * Playback bubble for a sent voice note: real waveform, scrubbing, elapsed
 * time, and a speed control.
 */
export function VoiceNotePlayer({
  src,
  durationMs,
  accent,
}: {
  src: string;
  durationMs?: number | null;
  accent?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<number[]>(placeholderPeaks);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState((durationMs ?? 0) / 1000);
  const [speedIndex, setSpeedIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadWaveform() {
      try {
        const context = sharedDecodeContext();
        if (!context) return;
        const response = await fetch(src);
        if (!response.ok || cancelled) return;
        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        const decoded = await context.decodeAudioData(buffer);
        if (cancelled) return;
        setPeaks(waveformPeaks(decoded.getChannelData(0)));
        // Container metadata is often missing for MediaRecorder output, so the
        // decoded length is the only dependable duration.
        if (Number.isFinite(decoded.duration) && decoded.duration > 0) {
          setDuration(decoded.duration);
        }
      } catch {
        // Keep the placeholder shape; playback still works without it.
      }
    }

    void loadWaveform();
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let frame = 0;
    const tick = () => {
      setElapsed(audio.currentTime);
      frame = requestAnimationFrame(tick);
    };
    if (playing) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;
  const speed = SPEEDS[speedIndex];

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }

  function cycleSpeed() {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }

  return (
    <div className={`voice-note-player${accent ? " is-accent" : ""}`}>
      <button
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className="voice-note-play"
        onClick={toggle}
        title={playing ? "Pause voice message" : "Play voice message"}
        type="button"
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <div className="voice-note-body">
        <Waveform
          peaks={peaks}
          progress={progress}
          onSeek={(ratio) => {
            const audio = audioRef.current;
            if (!audio || !duration) return;
            audio.currentTime = ratio * duration;
            setElapsed(audio.currentTime);
          }}
        />
        <div className="voice-note-meta">
          {/* Both values stay on screen so the length of the note is readable
              before it is played, not only while it runs. */}
          <span>
            {formatDuration(elapsed)}
            <i> / {formatDuration(duration)}</i>
          </span>
          <button
            aria-label="Playback speed"
            onClick={cycleSpeed}
            title="Change playback speed"
            type="button"
          >
            {speed}×
          </button>
        </div>
      </div>
      <audio
        onEnded={() => {
          setPlaying(false);
          setElapsed(0);
        }}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        preload="metadata"
        ref={audioRef}
        src={src}
      />
    </div>
  );
}

type RecorderState = "idle" | "recording" | "cancelling";

/**
 * WhatsApp-style recording bar.
 *
 * Replaces the composer while active: live waveform, running timer, drag left
 * to cancel, and an explicit send. The caller receives the encoded blob plus
 * its duration, so nothing is uploaded until the recording is actually sent.
 */
export function VoiceNoteRecorder({
  onSend,
  onCancel,
  onError,
}: {
  onSend: (file: File, durationMs: number) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [levels, setLevels] = useState<number[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);

  const recorderRef = useRef<MediaRecorder>(null);
  const streamRef = useRef<MediaStream>(null);
  const contextRef = useRef<AudioContext>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const frameRef = useRef(0);
  const cancelledRef = useRef(false);
  const dragStartRef = useRef<number>(null);

  const teardown = useCallback(async () => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    await contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
  }, []);

  const stop = useCallback(
    (cancelled: boolean) => {
      cancelledRef.current = cancelled;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else void teardown();
    },
    [teardown],
  );

  useEffect(() => {
    let disposed = false;

    async function begin() {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        onError("Voice recording is not supported by this browser.");
        onCancel();
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        onError("Microphone access was denied or is unavailable.");
        onCancel();
        return;
      }
      if (disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const preferred = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ];
      const mimeType =
        preferred.find((type) => MediaRecorder.isTypeSupported(type)) || "";
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const type = recorder.mimeType.split(";")[0] || "audio/webm";
        const extension =
          type === "audio/ogg" ? "ogg" : type === "audio/mp4" ? "m4a" : "webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        void teardown();
        if (cancelledRef.current || durationMs < 600 || !blob.size) {
          // Too short to be intentional; treat it as a cancel rather than
          // sending an empty note.
          onCancel();
          return;
        }
        onSend(
          new File([blob], `voice-${Date.now()}.${extension}`, { type }),
          durationMs,
        );
      };

      // An analyser taps the same stream without competing for the microphone,
      // which is what the previous recorder did by running speech recognition
      // alongside MediaRecorder.
      const context = new AudioContext();
      contextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);

      const sample = () => {
        analyser.getFloatTimeDomainData(buffer);
        let peak = 0;
        for (let index = 0; index < buffer.length; index += 1) {
          const value = buffer[index] < 0 ? -buffer[index] : buffer[index];
          if (value > peak) peak = value;
        }
        setLevels((current) => {
          const next = [...current, Math.min(1, peak * 1.6)];
          return next.length > WAVEFORM_BARS
            ? next.slice(next.length - WAVEFORM_BARS)
            : next;
        });
        setSeconds((Date.now() - startedAtRef.current) / 1000);
        frameRef.current = requestAnimationFrame(sample);
      };

      recorder.start(200);
      setState("recording");
      frameRef.current = requestAnimationFrame(sample);
    }

    void begin();
    return () => {
      disposed = true;
      cancelAnimationFrame(frameRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      void teardown();
    };
    // Runs once: the recorder owns its lifecycle from mount to unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancelThreshold = 96;

  function handleDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    dragStartRef.current = event.clientX;
  }

  function handleDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStartRef.current === null) return;
    const offset = Math.min(0, event.clientX - dragStartRef.current);
    setDragOffset(offset);
    setState(offset < -cancelThreshold ? "cancelling" : "recording");
  }

  function handleDragEnd() {
    if (dragStartRef.current === null) return;
    const shouldCancel = dragOffset < -cancelThreshold;
    dragStartRef.current = null;
    setDragOffset(0);
    if (shouldCancel) stop(true);
    else setState("recording");
  }

  const padded = [
    ...new Array(Math.max(0, WAVEFORM_BARS - levels.length)).fill(0),
    ...levels,
  ];

  return (
    <div
      className={`voice-recorder is-${state}`}
      onPointerCancel={handleDragEnd}
      onPointerDown={handleDragStart}
      onPointerMove={handleDragMove}
      onPointerUp={handleDragEnd}
      style={{ "--drag-offset": `${dragOffset}px` } as CSSProperties}
    >
      <button
        aria-label="Discard recording"
        title="Discard this recording"
        className="voice-recorder-discard"
        onClick={() => stop(true)}
        type="button"
      >
        <Trash2 size={17} />
      </button>

      <div className="voice-recorder-main">
        <span className="voice-recorder-dot" aria-hidden />
        <time>{formatDuration(seconds)}</time>
        <div className="voice-recorder-wave" aria-hidden>
          {padded.map((level, index) => (
            <span
              key={index}
              style={{ height: `${Math.max(8, Math.round(level * 100))}%` }}
            />
          ))}
        </div>
        <span className="voice-recorder-hint">
          {state === "cancelling" ? "Release to cancel" : "‹ Slide to cancel"}
        </span>
      </div>

      <button
        aria-label="Send voice message"
        title="Send voice message"
        className="voice-recorder-send"
        onClick={() => stop(false)}
        type="button"
      >
        {state === "cancelling" ? <Trash2 size={17} /> : <Send size={16} />}
      </button>
    </div>
  );
}

export { Mic as VoiceNoteIcon };
