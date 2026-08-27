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

/**
 * What an impersonated session is allowed to do.
 *
 * Three tiers rather than a read-write flag, because the flag could not express
 * the case this feature is actually for. "It gives me an error" cannot be
 * diagnosed by looking: the error appears when you *use* the thing, and using
 * it means writing something. So a read-only session cannot reproduce a fault,
 * and the only alternative on offer was full write access to a stranger's
 * account - which is far more than reproducing a fault requires.
 *
 * `sandbox` is the missing middle. It permits exactly the writes that a
 * conversation needs and refuses every other kind, so an administrator can talk
 * to the agent, see what the customer sees, and change nothing the customer
 * owns. What it does write is tagged, hidden from the customer, and deleted
 * when the session ends.
 *
 * `write` is unchanged in what it permits and changed in how it is reached: it
 * now requires the customer's recorded consent.
 */
export type ImpersonationMode = "read" | "sandbox" | "write";

export const IMPERSONATION_MODES: readonly ImpersonationMode[] = [
  "read",
  "sandbox",
  "write",
];

export function isImpersonationMode(
  value: unknown,
): value is ImpersonationMode {
  return (
    typeof value === "string" &&
    (IMPERSONATION_MODES as readonly string[]).includes(value)
  );
}

export type Impersonation = {
  workspaceId: string;
  /** Shown in the banner, so the administrator can see whose data this is. */
  workspaceName: string;
  /** The administrator who started it. Never the person being impersonated. */
  adminEmail: string;
  /** What this session may do. Lowest tier unless deliberately raised. */
  mode: ImpersonationMode;
  expiresAt: number;
};

/** Whether this session may write anything at all. */
export function canWriteAnything(session: { mode: ImpersonationMode }) {
  return session.mode !== "read";
}

/**
 * The exact bytes that get signed.
 *
 * Every field, in a fixed order. Signing a subset would leave the rest
 * editable, and `mode` is the one that matters most: a read-only session whose
 * tier could be edited to `write` is not read-only, and is not a sandbox
 * either.
 *
 * JSON rather than a joined string, because a workspace name may contain the
 * separator. Joined with a space, these two sessions sign identically:
 *
 *   ["ws-1", "Acme Corp", "a@b.c", "read", "1"]
 *   ["ws-1", "Acme", "Corp a@b.c", "read", "1"]
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
    session.mode,
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
 *
 * An unrecognised mode is rejected rather than treated as the safe tier. The
 * signature has already been checked by the time this runs, so a mode this
 * build does not know about means the cookie was minted by a different version
 * of the application - and guessing what an older or newer build meant by it is
 * exactly the kind of assumption that turns into a privilege bug.
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
    !isImpersonationMode(session?.mode) ||
    typeof session?.expiresAt !== "number"
  ) {
    return null;
  }
  return session;
}
