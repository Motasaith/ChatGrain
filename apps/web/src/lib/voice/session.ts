import { desc, eq, sql } from "drizzle-orm";
import type { Agent } from "@/lib/db/schema";
import { answerQuestionStream, type AnswerHistoryMessage } from "@/lib/chat/answer";
import { db } from "@/lib/db/client";
import { conversations, messages } from "@/lib/db/schema";
import { logger } from "@/lib/observability/logger";
import { pcmDurationMs } from "@/lib/voice/audio";
import {
  CAPTURE_SAMPLE_RATE,
  type ServerMessage,
  type VoiceState,
} from "@/lib/voice/protocol";
import { sttEnabled, transcribeUtterance } from "@/lib/voice/stt";
import { SpeechChunker, synthesizeSpeech, ttsEnabled } from "@/lib/voice/tts";

/** Hard cap on one utterance so a stuck client cannot exhaust memory. */
const MAX_UTTERANCE_BYTES = CAPTURE_SAMPLE_RATE * 2 * 30; // 30 seconds

/** Utterances shorter than this are treated as a cough or a door slam. */
const MIN_UTTERANCE_BYTES = CAPTURE_SAMPLE_RATE * 2 * 0.25; // 250 ms

export type VoiceSessionDeps = {
  agent: Agent;
  conversationId: string;
  sessionId: string;
  locale?: string;
  send: (message: ServerMessage) => void;
  sendAudio: (turnId: number, pcm: Uint8Array) => void;
};

/**
 * Drives one live call.
 *
 * Exactly one turn is in flight at a time. A caller speaking over the agent
 * aborts the running turn at every stage it can be aborted - generation,
 * synthesis, and playback - which is what makes barge-in feel instant instead
 * of leaving a tail of stale audio queued on the client.
 */
/**
 * Whether speech onset from the caller should abandon the turn in flight.
 *
 * Only when the agent is audible. Barging in means talking over something you
 * can hear; there is nothing to talk over while the agent is still working out
 * what to say, and treating noise as an interruption there cancelled answers
 * before they could be given.
 */
export function isBargeIn(state: VoiceState) {
  return state === "speaking";
}
export class VoiceSession {
  private state: VoiceState = "listening";
  private nextTurnId = 1;
  private buffered: Uint8Array[] = [];
  private bufferedBytes = 0;
  private active?: { id: number; abort: AbortController; done: Promise<void> };
  private closed = false;

  constructor(private readonly deps: VoiceSessionDeps) {}

  get currentState() {
    return this.state;
  }

  private setState(value: VoiceState) {
    if (this.state === value || this.closed) return;
    this.state = value;
    this.deps.send({ type: "state", value });
  }

  /** Buffers a frame of 16 kHz mono PCM from the caller. */
  appendAudio(pcm: Uint8Array) {
    if (this.closed) return;
    this.buffered.push(pcm);
    this.bufferedBytes += pcm.byteLength;
    // Answer what was said so far rather than dropping the overflow: a client
    // whose VAD never closes (steady background noise) would otherwise talk
    // into a buffer that is silently discarded.
    if (this.bufferedBytes >= MAX_UTTERANCE_BYTES) this.utteranceEnd();
  }

  /**
   * The client's VAD detected speech onset. If the agent is mid-sentence the
   * caller is talking over it, so the turn is abandoned immediately.
   *
   * Only while it is actually audible. "Thinking" used to cancel here too, and
   * that is not a barge-in: the caller has heard nothing yet, so there is
   * nothing for them to be interrupting. What it did instead was hand every
   * cough, keyboard tap and passing car a veto over the answer - onset alone,
   * no words required - and the call would drop straight back to listening a
   * second after the question, having said nothing. The first turn of a call
   * was the likeliest to lose, because that is when the speech model is still
   * loading and the window is widest.
   *
   * A caller who genuinely asks something new during the wait is still obeyed:
   * a completed utterance reaches `utteranceEnd`, and `runTurn` cancels
   * whatever was in flight before starting the replacement.
   */
  speechStart() {
    if (this.closed) return;
    if (isBargeIn(this.state)) this.cancelActiveTurn();
  }

  /** The client's VAD detected end of speech: transcribe and answer. */
  utteranceEnd() {
    if (this.closed) return;
    const pcm = this.drainBuffer();
    if (!pcm || pcm.byteLength < MIN_UTTERANCE_BYTES) return;
    if (!sttEnabled()) {
      this.deps.send({
        type: "error",
        code: "STT_UNAVAILABLE",
        message:
          "Speech recognition is not configured on this server. You can type instead.",
      });
      return;
    }
    void this.runTurn({ pcm });
  }

  /** Typed fallback while a call is open. */
  submitText(content: string) {
    const text = content.trim();
    if (this.closed || !text) return;
    this.cancelActiveTurn();
    void this.runTurn({ text });
  }

  interrupt(turnId: number) {
    if (this.active?.id === turnId) this.cancelActiveTurn();
  }

  async close() {
    this.closed = true;
    this.cancelActiveTurn();
    await this.active?.done.catch(() => undefined);
    this.buffered = [];
    this.bufferedBytes = 0;
  }

  private drainBuffer() {
    if (!this.bufferedBytes) return null;
    const merged = new Uint8Array(this.bufferedBytes);
    let offset = 0;
    for (const chunk of this.buffered) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.buffered = [];
    this.bufferedBytes = 0;
    return merged;
  }

  private cancelActiveTurn() {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    active.abort.abort();
    this.deps.send({ type: "cancelled", turnId: active.id });
    this.setState("listening");
  }

  private async runTurn(input: { pcm?: Uint8Array; text?: string }) {
    this.cancelActiveTurn();
    const id = this.nextTurnId;
    this.nextTurnId += 1;
    const abort = new AbortController();
    const done = this.executeTurn(id, abort.signal, input).catch((error) => {
      if (!abort.signal.aborted) {
        logger.warn({ error, turnId: id }, "Voice turn failed");
        this.deps.send({
          type: "error",
          code: "TURN_FAILED",
          message: "Something went wrong answering that. Please try again.",
        });
        this.setState("listening");
      }
    });
    this.active = { id, abort, done };
    await done;
    if (this.active?.id === id) this.active = undefined;
  }

  private async executeTurn(
    turnId: number,
    signal: AbortSignal,
    input: { pcm?: Uint8Array; text?: string },
  ) {
    const startedAt = Date.now();
    this.setState("thinking");

    let question = input.text?.trim() ?? "";
    if (!question && input.pcm) {
      question = await transcribeUtterance(input.pcm, {
        language: this.deps.locale,
        signal,
      });
      if (signal.aborted) return;
      if (!question) {
        // Silence or noise: quietly return to listening rather than making the
        // caller sit through an "I did not catch that" every time.
        this.setState("listening");
        return;
      }
      logger.debug(
        {
          turnId,
          audioMs: pcmDurationMs(input.pcm.byteLength),
          sttMs: Date.now() - startedAt,
        },
        "Voice utterance transcribed",
      );
    }
    if (!question) {
      this.setState("listening");
      return;
    }

    this.deps.send({ type: "transcript", turnId, text: question });
    const history = await this.loadHistory();
    if (signal.aborted) return;

    await db.insert(messages).values({
      conversationId: this.deps.conversationId,
      role: "user",
      content: question,
    });
    if (signal.aborted) return;

    const speaking = ttsEnabled();
    const chunker = new SpeechChunker();
    const synthesisQueue: Array<Promise<void>> = [];
    let audioStarted = false;
    let answer = "";
    let grounded = true;
    let streamed = "";
    let persisted = false;
    let citations: Array<{
      chunkId: string;
      title: string;
      url?: string;
      excerpt: string;
    }> = [];

    let audioRate = 0;
    const speak = async (text: string) => {
      if (!speaking || signal.aborted) return;
      for await (const { pcm, sampleRate } of synthesizeSpeech(text, { signal })) {
        if (signal.aborted) return;
        // The rate comes from the speech server rather than configuration, and
        // a change mid-turn needs its own header or the client would play the
        // remaining audio at the wrong pitch.
        if (!audioStarted || sampleRate !== audioRate) {
          audioStarted = true;
          audioRate = sampleRate;
          this.setState("speaking");
          this.deps.send({ type: "audio_start", turnId, sampleRate });
        }
        this.deps.sendAudio(turnId, pcm);
      }
    };

    /** Serializes synthesis so sentences are spoken in order. */
    const enqueue = (text: string) => {
      const previous = synthesisQueue[synthesisQueue.length - 1] ?? Promise.resolve();
      const next = previous.then(() => speak(text)).catch(() => undefined);
      synthesisQueue.push(next);
    };

    const persist = async (
      content: string,
      wasGrounded: boolean,
      answerCitations: typeof citations,
    ) => {
      persisted = true;
      await db.insert(messages).values({
        conversationId: this.deps.conversationId,
        role: "assistant",
        content,
        citations: answerCitations,
        grounded: wasGrounded,
        latencyMs: Date.now() - startedAt,
      });
      await db
        .update(conversations)
        .set({
          lastMessageAt: new Date(),
          updatedAt: new Date(),
          // Only the first turn names the call, matching the HTTP chat route.
          title: sql`coalesce(${conversations.title}, ${question.replace(/\s+/g, " ").slice(0, 90)})`,
        })
        .where(eq(conversations.id, this.deps.conversationId));
    };

    try {
      for await (const event of answerQuestionStream(
        this.deps.agent,
        question,
        history,
        { voice: true, signal },
      )) {
        if (signal.aborted) return;
        if (event.type === "delta") {
          streamed += event.text;
          this.deps.send({ type: "answer_delta", turnId, text: event.text });
          for (const chunk of chunker.push(event.text)) enqueue(chunk);
          continue;
        }
        answer = event.answer;
        grounded = event.grounded;
        citations = event.citations;
      }
      if (signal.aborted) return;

      const tail = chunker.flush();
      // Shortcut branches never emit deltas, so nothing reached the chunker and
      // the whole answer still has to be spoken.
      if (tail) enqueue(tail);
      else if (!audioStarted && answer) enqueue(answer);

      this.deps.send({
        type: "answer",
        turnId,
        text: answer,
        grounded,
        citations,
      });

      await Promise.all(synthesisQueue);
      if (signal.aborted) return;

      if (audioStarted) this.deps.send({ type: "audio_end", turnId });
      await persist(answer, grounded, citations);
      this.setState("listening");
    } finally {
      // A barge-in returns early from the block above. The caller's question is
      // already stored, so without this the conversation history - and the
      // operator's view of it - would show a question with no reply at all.
      if (!persisted && streamed.trim()) {
        await persist(`${streamed.trim()} —`, grounded, citations).catch(
          (error) =>
            logger.warn({ error, turnId }, "Interrupted voice turn not stored"),
        );
      }
    }
  }

  private async loadHistory(): Promise<AnswerHistoryMessage[]> {
    const recent = await db
      .select({
        role: messages.role,
        content: messages.content,
        citations: messages.citations,
        grounded: messages.grounded,
      })
      .from(messages)
      .where(eq(messages.conversationId, this.deps.conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(12);
    return recent
      .reverse()
      .filter(
        (message): message is typeof message & { role: "user" | "assistant" } =>
          message.role === "user" || message.role === "assistant",
      );
  }
}
