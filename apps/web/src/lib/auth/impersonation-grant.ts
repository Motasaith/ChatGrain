import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { impersonationGrants } from "@/lib/db/schema";

/**
 * Asking a customer for permission, and checking they gave it.
 *
 * The rule: an administrator may look without asking and may reproduce a fault
 * in a sandbox without asking, but may not change anything a customer owns
 * without the customer saying so.
 *
 * That is a judgement about consent, not about trust. Administrators here are
 * colleagues, and the point is not to catch one behaving badly - it is that a
 * customer whose prompt changed overnight deserves to have agreed to it, and
 * that "support fixed it for you" is a much easier conversation when there is a
 * row showing they asked and you said yes.
 */

/** How long a customer has to answer before the request goes stale. */
export const REQUEST_TTL_HOURS = 48;

/** How long write access lasts once granted. */
export const GRANT_TTL_HOURS = 24;

/**
 * The secret in the approval link.
 *
 * 32 bytes from the platform's CSPRNG, hex encoded. The link is the authority
 * that carries the customer's answer, so guessing one must be infeasible;
 * `Math.random` is not a source for anything of the kind.
 */
export function grantToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/**
 * Whether this administrator may currently write to this workspace.
 *
 * Checked at the moment a write session is started rather than trusted from the
 * cookie, because the cookie is minted once and consent can be withdrawn. The
 * session itself is still capped by its own expiry, so the worst case is a
 * write window outliving a revocation by the remainder of one short session -
 * and revoking also ends any session it authorised.
 */
export async function activeGrant(workspaceId: string, adminEmail: string) {
  const [grant] = await db
    .select()
    .from(impersonationGrants)
    .where(
      and(
        eq(impersonationGrants.workspaceId, workspaceId),
        // Addresses are compared case-insensitively: the same person signing in
        // as A@b.c and a@b.c is the same person, and a grant that silently did
        // not apply would be read as the feature being broken.
        sql`lower(${impersonationGrants.adminEmail}) = lower(${adminEmail})`,
        eq(impersonationGrants.status, "approved"),
        gt(impersonationGrants.grantExpiresAt, new Date()),
      ),
    )
    .orderBy(desc(impersonationGrants.grantExpiresAt))
    .limit(1);
  return grant ?? null;
}

/**
 * The email a customer receives, and the message shown when there is no mailer.
 *
 * One function for both so the two cannot drift. An installation with no
 * outbound email is the normal case for a self-hosted deployment, and telling
 * an administrator "email is not configured" while offering nothing else would
 * leave them doing the thing this is meant to prevent: changing an account and
 * mentioning it afterwards. The text is written to be pasted into whatever
 * they already talk to the customer through.
 */
export function grantRequestMessage({
  workspaceName,
  adminEmail,
  reason,
  approveUrl,
  expiresAt,
}: {
  workspaceName: string;
  adminEmail: string;
  reason: string;
  approveUrl: string;
  expiresAt: Date;
}) {
  const subject = `Permission needed to make changes to ${workspaceName}`;
  const body = [
    `${adminEmail} is asking for permission to make changes inside your`,
    `ChatGrain workspace, ${workspaceName}.`,
    "",
    "Their reason:",
    `  ${reason}`,
    "",
    "Nothing has been changed. Support can already see your dashboard to",
    "answer questions about it, and can talk to your agent to reproduce a",
    "problem, but they cannot alter your agent, your prompt, your sources or",
    "your settings unless you allow it here:",
    "",
    `  ${approveUrl}`,
    "",
    `This request expires on ${expiresAt.toUTCString()}. If you do nothing, it`,
    "lapses and no access is given. Access lasts",
    `${GRANT_TTL_HOURS} hours once granted, and you can withdraw it at any time.`,
    "",
    "If you were not expecting this, decline it and tell us.",
  ].join("\n");
  return { subject, body };
}
