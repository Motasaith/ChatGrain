import { describe, expect, it, beforeAll } from "vitest";
import { IMPERSONATION_COOKIE } from "@/lib/auth/impersonation-payload";
import { encodeImpersonationToken } from "@/lib/auth/impersonation-token";
import { blockedByReadOnlyImpersonation } from "./proxy";

const SECRET = "proxy-test-secret";

beforeAll(() => {
  process.env.WIDGET_SIGNING_SECRET = SECRET;
});

const cookieFor = async (over: Record<string, unknown> = {}) => {
  const token = await encodeImpersonationToken(
    {
      workspaceId: "ws-1",
      workspaceName: "Acme",
      adminEmail: "admin@example.com",
      mode: "read" as const,
      expiresAt: Date.now() + 60_000,
      ...over,
    },
    SECRET,
  );
  return `${IMPERSONATION_COOKIE}=${token}`;
};

const request = (method: string, cookie?: string) =>
  new Request("https://app.test/api/agents/x", {
    method,
    headers: cookie ? { cookie } : {},
  });

/**
 * Read-only impersonation is enforced here rather than in each mutating route,
 * because a rule every handler has to remember is a rule one of them will
 * forget - and the one that forgets will be a route written later by someone
 * who never read that file.
 */
describe("read-only impersonation", () => {
  it("lets reads through", async () => {
    const cookie = await cookieFor();
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(
        await blockedByReadOnlyImpersonation(request(method, cookie)),
        method,
      ).toBeNull();
    }
  });

  it("refuses every method that can change something", async () => {
    const cookie = await cookieFor();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const refused = await blockedByReadOnlyImpersonation(
        request(method, cookie),
      );
      expect(refused, method).not.toBeNull();
      expect(refused!.status, method).toBe(403);
    }
  });

  it("names the workspace being viewed, so the message is actionable", async () => {
    const refused = await blockedByReadOnlyImpersonation(
      request("POST", await cookieFor()),
    );
    const body = await refused!.json();
    expect(body.error.code).toBe("IMPERSONATION_READ_ONLY");
    expect(body.error.message).toContain("Acme");
  });

  it("allows writes when the session was granted them", async () => {
    const cookie = await cookieFor({ mode: "write" });
    expect(await blockedByReadOnlyImpersonation(request("POST", cookie))).toBeNull();
  });

  it("does nothing when nobody is impersonating", async () => {
    expect(await blockedByReadOnlyImpersonation(request("POST"))).toBeNull();
  });

  // A forged or expired cookie is not an impersonation session at all, so the
  // request proceeds as whoever is actually signed in. They gain nothing:
  // `getWorkspaceContext` rejects the same cookie and resolves their own
  // workspace, so this is a fall-through to normal behaviour, not a bypass.
  it("ignores a forged cookie rather than honouring it", async () => {
    const token = (await cookieFor()).split("=")[1];
    const [body] = token.split(".");
    const forged = `${IMPERSONATION_COOKIE}=${body}.${"0".repeat(64)}`;
    expect(await blockedByReadOnlyImpersonation(request("POST", forged))).toBeNull();
  });

  it("ignores an expired session", async () => {
    const cookie = await cookieFor({ expiresAt: Date.now() - 1 });
    expect(await blockedByReadOnlyImpersonation(request("POST", cookie))).toBeNull();
  });

  it("finds the cookie among others", async () => {
    const cookie = `foo=bar; ${await cookieFor()}; baz=qux`;
    const refused = await blockedByReadOnlyImpersonation(request("POST", cookie));
    expect(refused?.status).toBe(403);
  });
});

/**
 * The exit cannot be behind the lock.
 *
 * Ending a session is a DELETE. Refused along with every other write, an
 * administrator would be stuck inside a read-only session until it expired or
 * they cleared cookies by hand.
 */
describe("leaving an impersonation session", () => {
  it("is never blocked by the session it is leaving", async () => {
    const cookie = await cookieFor();
    for (const method of ["POST", "DELETE"]) {
      const refused = await blockedByReadOnlyImpersonation(
        new Request("https://app.test/api/admin/impersonate", {
          method,
          headers: { cookie },
        }),
      );
      expect(refused, method).toBeNull();
    }
  });

  it("still blocks other admin routes", async () => {
    const refused = await blockedByReadOnlyImpersonation(
      new Request("https://app.test/api/admin/jobs/abc", {
        method: "POST",
        headers: { cookie: await cookieFor() },
      }),
    );
    expect(refused?.status).toBe(403);
  });
});

/**
 * "Every request logged with both identities" was a promise in the plan, and
 * start/stop rows in the audit table cannot keep it - they cannot answer what
 * was actually looked at, which is the question anyone asks about this feature,
 * the customer included.
 */
describe("logging impersonated requests", () => {
  const captured: string[] = [];
  const withCapture = async (fn: () => Promise<unknown>) => {
    const original = console.info;
    captured.length = 0;
    console.info = (line: string) => captured.push(line);
    try {
      await fn();
    } finally {
      console.info = original;
    }
  };

  it("logs a read, which is the case start and stop miss entirely", async () => {
    const cookie = await cookieFor();
    await withCapture(() =>
      blockedByReadOnlyImpersonation(request("GET", cookie)),
    );
    expect(captured).toHaveLength(1);
    const entry = JSON.parse(captured[0]);
    expect(entry).toMatchObject({
      admin: "admin@example.com",
      workspace: "Acme",
      method: "GET",
      mode: "read",
    });
  });

  it("names both identities, not just the workspace", async () => {
    const cookie = await cookieFor();
    await withCapture(() =>
      blockedByReadOnlyImpersonation(request("POST", cookie)),
    );
    const entry = JSON.parse(captured[0]);
    expect(entry.admin).toBe("admin@example.com");
    expect(entry.workspace).toBe("Acme");
  });

  it("logs the refused write too, so an attempt is visible", async () => {
    const cookie = await cookieFor();
    await withCapture(() =>
      blockedByReadOnlyImpersonation(request("DELETE", cookie)),
    );
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0]).method).toBe("DELETE");
  });

  it("says nothing when nobody is impersonating", async () => {
    await withCapture(() => blockedByReadOnlyImpersonation(request("GET")));
    expect(captured).toHaveLength(0);
  });

  it("says nothing for a forged cookie", async () => {
    const token = (await cookieFor()).split("=")[1];
    const forged = `${IMPERSONATION_COOKIE}=${token.split(".")[0]}.${"0".repeat(64)}`;
    await withCapture(() =>
      blockedByReadOnlyImpersonation(request("GET", forged)),
    );
    expect(captured).toHaveLength(0);
  });
});
