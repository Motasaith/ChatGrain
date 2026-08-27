import "server-only";

import { cookies } from "next/headers";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_MAX_MINUTES,
  type Impersonation,
} from "./impersonation-payload";
import {
  decodeImpersonationToken,
  encodeImpersonationToken,
} from "./impersonation-token";

export {
  IMPERSONATION_COOKIE,
  IMPERSONATION_MAX_MINUTES,
  type Impersonation,
} from "./impersonation-payload";

/**
 * Letting an administrator stand where a customer is standing.
 *
 * The support case is real - "it gives me an error" cannot be answered without
 * seeing what they see - but this is the largest privilege in the application,
 * so the shape of it matters more than the convenience.
 *
 * Four rules, each guarding a specific way this goes wrong.
 *
 * **The administrator stays themselves.** No session is minted for the customer
 * and none of their credentials are used or needed. This is an override on
 * which workspace is resolved, not a change of identity, so an audit entry
 * written during impersonation still names who actually acted.
 *
 * **Read-only unless asked otherwise.** Most support requests are "show me what
 * they see", which needs no writes at all. Writing is a separate, explicit
 * decision and a separate audit entry. The read-only half is enforced in the
 * proxy, by HTTP method, because a rule that every mutating route has to
 * remember to apply is a rule that will eventually be forgotten by one of them.
 *
 * **It expires by itself.** The failure mode to design against is not an
 * administrator abusing this; it is an administrator forgetting they are in it
 * and reading a customer's data as though it were their own. A session that
 * ends on its own is the only version that survives being interrupted.
 *
 * **It is signed.** The cookie names a workspace, so an unsigned one would let
 * anybody able to set a cookie read any workspace in the system.
 */

const DEFAULT_MINUTES = 30;

export function impersonationSecret() {
  const value = process.env.WIDGET_SIGNING_SECRET?.trim();
  if (!value) {
    throw new Error(
      "WIDGET_SIGNING_SECRET must be set before impersonation can be used.",
    );
  }
  return value;
}

export function encodeImpersonation(session: Impersonation) {
  return encodeImpersonationToken(session, impersonationSecret());
}

export function decodeImpersonation(value: string | undefined) {
  // The absence of a cookie is checked before the secret is read, because
  // `impersonationSecret()` throws when it is unset - and as an argument it was
  // evaluated whether or not there was anything to verify. An installation
  // without WIDGET_SIGNING_SECRET would therefore have had every
  // administrator's dashboard fail on a feature nobody was using.
  if (!value) return Promise.resolve(null);
  return decodeImpersonationToken(value, impersonationSecret());
}

export function impersonationSession(
  workspaceId: string,
  workspaceName: string,
  adminEmail: string,
  { canWrite = false, minutes = DEFAULT_MINUTES } = {},
): Impersonation {
  const capped = Math.min(Math.max(1, minutes), IMPERSONATION_MAX_MINUTES);
  return {
    workspaceId,
    workspaceName,
    adminEmail,
    canWrite,
    expiresAt: Date.now() + capped * 60_000,
  };
}

/**
 * The current session, or null.
 *
 * Never throws. This runs inside `getWorkspaceContext()`, which every page and
 * every API route depends on, so a fault here would take down the application
 * for an administrator - and it would do so over an optional feature that is
 * not in use on most requests. Failing to read a cookie means "nobody is
 * impersonating", which is both the safe answer and almost always the true one.
 */
export async function readImpersonation() {
  try {
    const store = await cookies();
    return await decodeImpersonation(store.get(IMPERSONATION_COOKIE)?.value);
  } catch {
    return null;
  }
}
