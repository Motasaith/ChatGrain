import type { ImpersonationMode } from "./impersonation-payload";

/**
 * What a sandboxed impersonation session is allowed to write.
 *
 * Runtime-neutral and free of imports for the same reason the payload is: the
 * proxy runs at the edge and this has to be the same decision there as in a
 * route handler. A second copy of an allowlist is a second thing to forget.
 *
 * The list is deliberately short, and the rule that produced it is: a sandbox
 * may write things that belong to a conversation it started, and nothing else.
 * Everything a customer owns - their agent, its prompt, their sources, their
 * settings, their team - is out of reach in a sandbox regardless of route, so
 * the answer to "can an administrator change my configuration without asking"
 * stays no.
 */

/** Methods that cannot change anything. */
export const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The way out of a session, exempt at every tier.
 *
 * Ending an impersonation session is a DELETE, so a blanket refusal of every
 * write would trap an administrator inside a session with no way to leave it
 * except waiting out the expiry or clearing cookies by hand. The exit cannot be
 * behind the lock.
 */
export const IMPERSONATION_ROUTE = "/api/admin/impersonate";

/**
 * Conversation traffic: starting one, sending a turn, reading it back.
 *
 * `/api/chat/` is the turn itself. The public agent routes carry the
 * conversation lifecycle that the widget uses, which is the same code path a
 * customer's visitor takes - and taking the same path is the entire point,
 * because a fault that only appears on the real path is exactly the fault worth
 * reproducing.
 */
const SANDBOX_WRITABLE_PREFIXES = [
  "/api/chat/",
  "/api/public/agents/",
  "/api/public/site-agent",
];

/**
 * Routes that reach outside the sandbox, refused even though they sit under a
 * writable prefix.
 *
 * A ticket and a lead are not scratch data. Both are delivered - a ticket
 * notifies the customer's support address, a lead lands in the list their sales
 * people work from - and an effect that leaves the building cannot be taken
 * back when the session ends. Reproducing "the widget errors when I ask for a
 * human" is worth doing; sending their support desk a fake ticket to prove it
 * is not.
 */
const SANDBOX_REFUSED_SUFFIXES = ["/tickets", "/leads"];

export function sandboxAllowsWrite(pathname: string) {
  if (SANDBOX_REFUSED_SUFFIXES.some((suffix) => pathname.endsWith(suffix))) {
    return false;
  }
  return SANDBOX_WRITABLE_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}

export type WriteDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

/**
 * Whether this request may proceed, and if not, what to tell the person.
 *
 * The message matters more than it looks. An administrator who is refused
 * needs to know which of three tiers they are in and what would change it,
 * otherwise the failure reads as a bug in the application rather than as the
 * boundary doing its job - and the next thing they do is ask for full write
 * access they did not need.
 */
export function decideImpersonatedWrite({
  method,
  pathname,
  mode,
  workspaceName,
}: {
  method: string;
  pathname: string;
  mode: ImpersonationMode;
  workspaceName: string;
}): WriteDecision {
  if (READ_METHODS.has(method)) return { allowed: true };
  if (pathname === IMPERSONATION_ROUTE) return { allowed: true };
  if (mode === "write") return { allowed: true };

  if (mode === "sandbox") {
    if (sandboxAllowsWrite(pathname)) return { allowed: true };
    return {
      allowed: false,
      code: "IMPERSONATION_SANDBOX",
      message:
        `You are in a sandbox session on ${workspaceName}. You can talk to ` +
        "their agent and reproduce what they see, but nothing they own can be " +
        "changed from here. To change something, request write access - it " +
        "goes to them to approve.",
    };
  }

  return {
    allowed: false,
    code: "IMPERSONATION_READ_ONLY",
    message:
      `You are viewing ${workspaceName} as an administrator. This session is ` +
      "read-only, so nothing can be changed from it. Switch to a sandbox " +
      "session to reproduce a fault without touching their data.",
  };
}
