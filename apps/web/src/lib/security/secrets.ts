import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption for secrets customers hand us, such as their own LLM API key.
 *
 * A key belongs to the customer, not to us: a database dump, a backup on a
 * developer's laptop, or a support engineer reading a row must not be enough
 * to spend someone else's credits. AES-256-GCM is authenticated, so a modified
 * ciphertext fails to decrypt rather than yielding rubbish.
 */

const VERSION = "v1";

/** Refuses to run without a key rather than falling back to plaintext. */
function encryptionKey() {
  const raw = process.env.SECRET_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32).",
    );
  }
  return key;
}

export function secretsConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string) {
  const key = encryptionKey();
  // GCM needs a unique IV per message; reusing one would leak plaintext.
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Returns null for anything unreadable rather than throwing.
 *
 * A rotated key or a truncated column should degrade to "no custom provider",
 * not take down every answer for that agent.
 */
export function decryptSecret(stored: string | null | undefined) {
  if (!stored) return null;
  const [version, iv, tag, ciphertext] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** "gsk_...4f21" - enough to recognise a key without revealing it. */
export function maskSecret(plaintext: string) {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}
