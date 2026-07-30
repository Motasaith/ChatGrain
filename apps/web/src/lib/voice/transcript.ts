/**
 * Whisper annotates non-speech audio with bracketed markers such as
 * `[BELL RINGING]`, `[BLANK_AUDIO]`, `(silence)`, or `[MUSIC]`. These are
 * descriptions of the audio, not words anyone said, so they must never be
 * treated as a question: retrieval on "[BELL RINGING]" returns whatever
 * happens to mention a bell and the agent answers something nonsensical.
 */
const NOISE_ONLY = /^[\s]*[[(][^\])]*[\])][\s]*$/;

/** Leading markers Whisper sometimes prepends to genuine speech. */
const LEADING_MARKERS = /^(?:[[(][^\])]*[\])]\s*)+/;

/**
 * Normalizes a raw transcript, returning an empty string when the audio held
 * no actual speech.
 */
export function cleanTranscript(value: string | null | undefined) {
  const text = (value ?? "").trim();
  if (!text || NOISE_ONLY.test(text)) return "";
  return text.replace(LEADING_MARKERS, "").trim();
}
