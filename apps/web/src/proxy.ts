import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { IMPERSONATION_COOKIE } from "@/lib/auth/impersonation-payload";
import { decodeImpersonationToken } from "@/lib/auth/impersonation-token";

/**
 * Exported as `proxy`, not as a default.
 *
 * Next 16 renamed the `middleware` convention to `proxy`, and its runtime reads
 * the two exports differently: the default export is treated as the *adapter*
 * that the build injects, while the request handler is looked up as the named
 * `proxy` (or legacy `middleware`) export -
 *
 *   const adapterFn = middlewareModule.default || middlewareModule;
 *   adapterFn({ handler: middlewareModule.proxy || middlewareModule.middleware ... })
 *
 * A lone default export therefore gets called with the adapter's argument shape
 * instead of a request, which surfaces as `TypeError: adapterFn is not a
 * function` and a 404 on every route.
 */

/** Methods that cannot change anything. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The way out.
 *
 * Ending an impersonation session is a DELETE, so a blanket refusal of every
 * write would trap an administrator inside a read-only session with no way to
 * leave it except waiting out the expiry or clearing cookies by hand. The exit
 * cannot be behind the lock.
 *
 * Exempting it costs nothing: the route reads the same cookie, requires an
 * administrator, and its only effect is to remove the session.
 */
const IMPERSONATION_ROUTE = "/api/admin/impersonate";

/**
 * Read-only impersonation, enforced by HTTP method.
 *
 * Here rather than in the routes, and that is the whole point. A rule applied
 * by each mutating handler is a rule that one of them will eventually forget,
 * and the one that forgets will be a new route written by someone who never
 * read this file. Enforcing it at the single point every request passes
 * through means the default for anything added later is "refused", which is the
 * correct direction to fail in.
 *
 * The cookie is verified rather than trusted. It names a workspace and carries
 * the read-write flag, so an unsigned one would let anybody able to set a
 * cookie read any workspace and write to it.
 */
/** The impersonation cookie on this request, verified, or null. */
async function sessionFor(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${IMPERSONATION_COOKIE}=`))
    ?.slice(IMPERSONATION_COOKIE.length + 1);
  if (!cookie) return null;

  const secret = process.env.WIDGET_SIGNING_SECRET?.trim();
  // No secret means no verified session, so there is nothing to enforce and
  // nothing to trust either. Falling through leaves the request as it would
  // have been before impersonation existed.
  if (!secret) return null;

  return decodeImpersonationToken(decodeURIComponent(cookie), secret);
}

/**
 * One line per request made while impersonating, naming both identities.
 *
 * Starting and ending a session are recorded in the audit table, but those two
 * rows cannot answer "what did they actually look at" - and that is the
 * question anyone asks about this feature, including the customer whose account
 * it was. Written here because the proxy is the only place that sees every
 * request, reads, writes and page loads alike.
 *
 * To the process log rather than the database: a read costing a round trip and
 * a row would make browsing somebody's dashboard quadratic in cost, and the
 * database already holds the entries that matter for consequences - the session
 * itself, and every mutation, which the routes audit on their own.
 */
function logImpersonatedRequest(
  request: Request,
  session: { adminEmail: string; workspaceName: string; canWrite: boolean },
) {
  const url = new URL(request.url);
  console.info(
    JSON.stringify({
      msg: "Impersonated request",
      admin: session.adminEmail,
      workspace: session.workspaceName,
      canWrite: session.canWrite,
      method: request.method,
      path: url.pathname,
      at: new Date().toISOString(),
    }),
  );
}

export async function blockedByReadOnlyImpersonation(request: Request) {
  const session = await sessionFor(request);
  if (session) logImpersonatedRequest(request, session);

  if (READ_METHODS.has(request.method)) return null;
  if (new URL(request.url).pathname === IMPERSONATION_ROUTE) return null;
  if (!session || session.canWrite) return null;

  return NextResponse.json(
    {
      error: {
        code: "IMPERSONATION_READ_ONLY",
        message:
          `You are viewing ${session.workspaceName} as an administrator. ` +
          "This session is read-only, so nothing can be changed from it.",
      },
    },
    { status: 403 },
  );
}

export const proxy = clerkMiddleware(async (_auth, request) => {
  const refused = await blockedByReadOnlyImpersonation(request);
  if (refused) return refused;
  return undefined;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
