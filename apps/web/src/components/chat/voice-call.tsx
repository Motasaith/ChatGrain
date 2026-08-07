"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, PhoneOff } from "lucide-react";
import {
  VoiceCall,
  type CallStatus,
  type StartCallOptions,
} from "@/lib/voice/client/call";
import type { VoiceCitation } from "@/lib/voice/protocol";

type CallTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: VoiceCitation[];
};

const STATUS_LABEL: Record<CallStatus, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  ended: "Call ended",
};

/** Bars in the visualizer, mirrored around the centre. */
const BAR_COUNT = 13;

export function VoiceCallOverlay({
  options,
  agentName,
  onClose,
  onTurns,
}: {
  options: StartCallOptions;
  agentName: string;
  onClose: () => void;
  /** Receives the finished call so the text chat can show it afterwards. */
  onTurns: (turns: CallTurn[], conversationId?: string) => void;
}) {
  const [status, setStatus] = useState<CallStatus>("connecting");
  const [turns, setTurns] = useState<CallTurn[]>([]);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [textFallback, setTextFallback] = useState(false);

  const callRef = useRef<VoiceCall>(null);
  const turnsRef = useRef<CallTurn[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns]);

  useEffect(() => {
    const call = new VoiceCall({
      onStatus: (value) => setStatus(value),
      onReady: ({ sttEnabled }) => {
        if (!sttEnabled) {
          setTextFallback(true);
          setError(
            "Speech recognition is not configured on this server, so the call is text-only.",
          );
        }
      },
      onUserTurn: (text) => {
        setTurns((current) => [
          ...current,
          { id: `u-${current.length}-${Date.now()}`, role: "user", text },
        ]);
      },
      onAgentDelta: (turnId, text) => {
        setTurns((current) => {
          const id = `a-${turnId}`;
          const existing = current.find((turn) => turn.id === id);
          if (!existing) {
            return [...current, { id, role: "assistant", text }];
          }
          return current.map((turn) =>
            turn.id === id ? { ...turn, text: turn.text + text } : turn,
          );
        });
      },
      onAgentTurn: ({ turnId, text, citations }) => {
        setTurns((current) => {
          const id = `a-${turnId}`;
          const existing = current.find((turn) => turn.id === id);
          const replaced = { id, role: "assistant" as const, text, citations };
          return existing
            ? current.map((turn) => (turn.id === id ? replaced : turn))
            : [...current, replaced];
        });
      },
      onCancelled: (turnId) => {
        // Mark the interrupted reply so the transcript does not read as if the
        // agent said a sentence it never finished out loud.
        setTurns((current) =>
          current.map((turn) =>
            turn.id === `a-${turnId}` && turn.text
              ? { ...turn, text: `${turn.text.trimEnd()} —` }
              : turn,
          ),
        );
      },
      onMicLevel: (value) => setLevel(value),
      onAgentLevel: (value) => setLevel(value),
      onError: (message, fatal) => {
        setError(message);
        if (fatal) setStatus("ended");
      },
    });
    callRef.current = call;
    void call.start(options).catch((cause) => {
      setError(
        cause instanceof Error ? cause.message : "The call could not be started.",
      );
      setStatus("ended");
    });

    return () => {
      void call.hangUp();
    };
    // The call owns its own lifecycle; restarting it on prop identity changes
    // would drop the connection mid-sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish() {
    if (closedRef.current) return;
    closedRef.current = true;
    onTurns(turnsRef.current, callRef.current?.activeConversationId);
    void callRef.current?.hangUp();
    onClose();
  }

  function toggleMute() {
    setMuted((current) => {
      const next = !current;
      callRef.current?.setMuted(next);
      return next;
    });
  }

  const active = status === "listening" || status === "speaking";

  return (
    <div className="voice-call" role="dialog" aria-label={`Voice call with ${agentName}`}>
      <header className="voice-call-header">
        <span className={`voice-call-status is-${status}`}>
          {status === "connecting" || status === "thinking" ? (
            <Loader2 className="spin" size={13} />
          ) : (
            <i className="voice-call-dot" aria-hidden />
          )}
          {STATUS_LABEL[status]}
        </span>
        <strong>{agentName}</strong>
      </header>

      <div className="voice-call-stage">
        <div
          className={`voice-orb is-${status}${muted ? " is-muted" : ""}`}
          style={{ "--voice-level": active ? level : 0 } as React.CSSProperties}
          aria-hidden
        >
          <span className="voice-orb-core" />
          <span className="voice-orb-ring" />
          <div className="voice-bars">
            {Array.from({ length: BAR_COUNT }, (_, index) => {
              // Centre bars react most, giving a symmetric waveform shape.
              const distance = Math.abs(index - (BAR_COUNT - 1) / 2);
              const falloff = 1 - distance / BAR_COUNT;
              return (
                <span
                  key={index}
                  style={{
                    ["--bar-scale" as string]: active
                      ? 0.18 + level * falloff * 1.9
                      : 0.18,
                    ["--bar-delay" as string]: `${index * 40}ms`,
                  }}
                />
              );
            })}
          </div>
        </div>
        <p className="voice-call-hint">
          {muted
            ? "Microphone muted"
            : status === "speaking"
              ? "Just start talking to interrupt"
              : status === "listening"
                ? "Speak whenever you are ready"
                : status === "thinking"
                  ? "Working on your answer"
                  : ""}
        </p>
      </div>

      <div className="voice-call-transcript" ref={transcriptRef}>
        {turns.map((turn) => (
          <p key={turn.id} className={`voice-turn is-${turn.role}`}>
            <span>{turn.text}</span>
            {turn.citations?.length ? (
              <span className="voice-turn-links">
                {turn.citations
                  .filter((citation) => citation.url)
                  .slice(0, 3)
                  .map((citation) => (
                    <a
                      key={citation.chunkId}
                      href={citation.url}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      {citation.title}
                    </a>
                  ))}
              </span>
            ) : null}
          </p>
        ))}
      </div>

      {error ? <p className="voice-call-error">{error}</p> : null}

      {textFallback ? (
        <form
          className="voice-call-fallback"
          onSubmit={(event) => {
            event.preventDefault();
            const field = event.currentTarget.elements.namedItem(
              "voiceText",
            ) as HTMLInputElement | null;
            if (!field?.value.trim()) return;
            setTurns((current) => [
              ...current,
              {
                id: `u-${current.length}-${Date.now()}`,
                role: "user",
                text: field.value.trim(),
              },
            ]);
            callRef.current?.sendText(field.value);
            field.value = "";
          }}
        >
          <input name="voiceText" placeholder="Type instead…" autoComplete="off" />
          <button type="submit">Send</button>
        </form>
      ) : null}

      <div className="voice-call-controls">
        <button
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          aria-pressed={muted}
          className={`voice-control${muted ? " is-active" : ""}`}
          title={muted ? "Unmute microphone" : "Mute microphone"}
          disabled={textFallback}
          onClick={toggleMute}
          type="button"
        >
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button
          aria-label="End call"
          title="End call"
          className="voice-control is-end"
          onClick={finish}
          type="button"
        >
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}

export type { CallTurn };
