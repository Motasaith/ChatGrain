import {
  impersonationPayload,
  parseImpersonationBody,
  splitImpersonationCookie,
  type Impersonation,
} from "./impersonation-payload";

/**
 * Signing and verifying the impersonation cookie, in either runtime.
 *
 * Web Crypto rather than `node:crypto`, and deliberately: the proxy that
 * enforces read-only runs on the edge, where `node:crypto` does not exist, and
 * two implementations of one HMAC is a drift risk that would fail open in the
 * worst possible place. `globalThis.crypto.subtle` is available in Node 18+ and
 * on the edge, so there is only one.
 *
 * `subtle.verify` also removes a hazard that a hand-rolled comparison invites:
 * it is constant-time by construction, so there is no timing-safe comparison to
 * remember to use.
 *
 * No `server-only` marker here, because the proxy has to import it.
 */

const encoder = new TextEncoder();

function base64UrlEncode(text: string) {
  const bytes = encoder.encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function hexToBytes(hex: string) {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function keyFor(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signImpersonation(
  session: Impersonation,
  secret: string,
) {
  const key = await keyFor(secret, "sign");
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(impersonationPayload(session)),
  );
  return bytesToHex(signature);
}

export async function encodeImpersonationToken(
  session: Impersonation,
  secret: string,
) {
  const body = base64UrlEncode(JSON.stringify(session));
  return `${body}.${await signImpersonation(session, secret)}`;
}

/**
 * Verifies a cookie value and returns the session, or null.
 *
 * Null for every failure - malformed, unsigned, wrongly signed, expired - and
 * without distinguishing them. There is nothing a caller can usefully do
 * differently, and "the signature was wrong" is not a thing to say out loud.
 */
export async function decodeImpersonationToken(
  value: string | undefined,
  secret: string,
): Promise<Impersonation | null> {
  const parts = splitImpersonationCookie(value);
  if (!parts) return null;

  let json: string;
  try {
    json = base64UrlDecode(parts.encoded);
  } catch {
    return null;
  }
  const session = parseImpersonationBody(json);
  if (!session) return null;

  const signature = hexToBytes(parts.signature);
  if (!signature) return null;

  const key = await keyFor(secret, "verify");
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(impersonationPayload(session)),
  );
  if (!valid) return null;
  // Checked after the signature, so an expired-but-forged token is rejected as
  // forged rather than as expired.
  if (session.expiresAt <= Date.now()) return null;
  return session;
}
