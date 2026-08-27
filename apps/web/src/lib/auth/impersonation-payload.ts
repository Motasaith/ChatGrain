/**
 * The wire format of an impersonation cookie, with no crypto and no imports.
 *
 * Separate from `impersonation.ts` because two runtimes have to agree on it.
 * The server signs with `node:crypto`; the proxy verifies with Web Crypto,
 * because Next's proxy runs on the edge where `node:crypto` is not available.
 * Two implementations of the same HMAC is a drift risk, so the part that is
 * easy to get subtly wrong - which fields are signed, and in what order - lives
 * here once and is imported by both.
 */

export const IMPERSONATION_COOKIE = "chatgrain_impersonation";

/** Long enough to investigate, short enough to forget safely. */
export const IMPERSONATION_MAX_MINUTES = 60;

export type Impersonation = {
  workspaceId: string;
  /** Shown in the banner, so the administrator can see whose data this is. */
  workspaceName: string;
  /** The administrator who started it. Never the person being impersonated. */
  adminEmail: string;
  /** Whether writes are permitted. Off unless deliberately turned on. */
  canWrite: boolean;
  expiresAt: number;
};

/**
 * The exact bytes that get signed.
 *
 * Every field, in a fixed order. Signing a subset would leave the rest
 * editable, and `canWrite` is the one that matters: a read-only session whose
 * flag could be flipped is not read-only.
 *
 * JSON rather than a joined string, because a workspace name may contain the
 * separator. Joined with a space, these two sessions sign identically:
 *
 *   ["ws-1", "Acme Corp", "a@b.c", "ro", "1"]
 *   ["ws-1", "Acme", "Corp a@b.c", "ro", "1"]
 *
 * A signature that cannot tell two payloads apart is not a signature. JSON
 * escapes the delimiter for us, so the encoding is unambiguous by construction
 * rather than by choosing a character we hope never appears.
 */
export function impersonationPayload(session: Impersonation) {
  return JSON.stringify([
    session.workspaceId,
    session.workspaceName,
    session.adminEmail,
    session.canWrite ? "rw" : "ro",
    String(session.expiresAt),
  ]);
}

/** Splits a cookie value without verifying it. Verification needs crypto. */
export function splitImpersonationCookie(value: string | undefined) {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!encoded || !signature) return null;
  return { encoded, signature };
}

/**
 * Parses decoded JSON into a session, without checking the signature.
 *
 * Never trust the result of this on its own - it is whatever the cookie said.
 * Takes text rather than base64 so this file needs no encoding primitives, and
 * therefore no `Buffer`, which does not exist in the runtime the proxy uses.
 */
export function parseImpersonationBody(json: string): Impersonation | null {
  let session: Impersonation;
  try {
    session = JSON.parse(json);
  } catch {
    return null;
  }
  if (
    typeof session?.workspaceId !== "string" ||
    typeof session?.workspaceName !== "string" ||
    typeof session?.adminEmail !== "string" ||
    typeof session?.canWrite !== "boolean" ||
    typeof session?.expiresAt !== "number"
  ) {
    return null;
  }
  return session;
}
