import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// impersonation.ts carries the server-only marker and reads cookies. Neither is
// available here, and neither is what these tests are about.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
import { impersonationPayload } from "./impersonation-payload";
import {
  decodeImpersonationToken,
  encodeImpersonationToken,
} from "./impersonation-token";

const SECRET = "test-secret-for-impersonation";

const session = (over: Record<string, unknown> = {}) => ({
  workspaceId: "ws-1",
  workspaceName: "Acme",
  adminEmail: "admin@example.com",
  mode: "read" as const,
  expiresAt: Date.now() + 30 * 60_000,
  ...over,
});

const encode = (s: ReturnType<typeof session>) =>
  encodeImpersonationToken(s, SECRET);
const decode = (value: string | undefined) =>
  decodeImpersonationToken(value, SECRET);

/** Re-signs a body with a session it does not describe. */
const forge = async (
  signed: ReturnType<typeof session>,
  claimed: Record<string, unknown>,
) => {
  const signature = (await encode(signed)).split(".")[1];
  const body = Buffer.from(JSON.stringify({ ...signed, ...claimed })).toString(
    "base64url",
  );
  return `${body}.${signature}`;
};

describe("impersonation tokens", () => {
  it("round-trips a valid session", async () => {
    expect(await decode(await encode(session()))).toMatchObject({
      workspaceId: "ws-1",
      adminEmail: "admin@example.com",
      mode: "read",
    });
  });

  // The cookie names a workspace. Unsigned, anyone able to set a cookie could
  // read any workspace in the system.
  it("refuses a token with no signature", async () => {
    const body = (await encode(session())).split(".")[0];
    expect(await decode(body)).toBeNull();
  });

  it("refuses a tampered signature", async () => {
    const [body] = (await encode(session())).split(".");
    expect(await decode(`${body}.${"0".repeat(64)}`)).toBeNull();
  });

  it("refuses a signature that is not hex", async () => {
    const [body] = (await encode(session())).split(".");
    expect(await decode(`${body}.not-hex-at-all`)).toBeNull();
  });

  it("refuses a token signed with a different secret", async () => {
    const other = await encodeImpersonationToken(session(), "another-secret");
    expect(await decode(other)).toBeNull();
  });

  it("refuses an edited workspace", async () => {
    expect(await decode(await forge(session(), { workspaceId: "ws-other" }))).toBeNull();
  });

  // The one that matters most: a read-only session whose tier can be edited is
  // not read-only, and is not a sandbox either.
  it("refuses an escalation from read to write", async () => {
    expect(await decode(await forge(session(), { mode: "write" }))).toBeNull();
  });

  it("refuses an escalation from read to sandbox", async () => {
    expect(await decode(await forge(session(), { mode: "sandbox" }))).toBeNull();
  });

  it("refuses an escalation from sandbox to write", async () => {
    expect(
      await decode(
        await forge(session({ mode: "sandbox" }), { mode: "write" }),
      ),
    ).toBeNull();
  });

  // A mode this build does not recognise is rejected rather than treated as the
  // safe tier. The signature has already passed by then, so an unknown value
  // means a cookie minted by a different version - and guessing what it meant
  // is how a privilege bug gets written.
  it("refuses a mode it does not recognise", async () => {
    expect(
      await decode(await encode(session({ mode: "superuser" }))),
    ).toBeNull();
  });

  it("refuses an extended expiry", async () => {
    const s = session();
    expect(
      await decode(await forge(s, { expiresAt: s.expiresAt + 86_400_000 })),
    ).toBeNull();
  });

  // Expiry is what makes an interrupted administrator safe.
  it("refuses a session that has expired", async () => {
    expect(await decode(await encode(session({ expiresAt: Date.now() - 1 })))).toBeNull();
  });

  it("refuses junk", async () => {
    for (const bad of [undefined, "", "nonsense", "a.b", "...."]) {
      expect(await decode(bad as string | undefined), String(bad)).toBeNull();
    }
  });
});

describe("payload encoding", () => {
  // Found by inspection, not by a failing test: the payload was a space-joined
  // string, and a workspace name may contain spaces. These two sessions are
  // different and signed identically, so one signature verified both.
  it("does not confuse two sessions that differ only by where a space falls", () => {
    expect(
      impersonationPayload(session({ workspaceName: "Acme Corp" }) as never),
    ).not.toBe(
      impersonationPayload(
        session({
          workspaceName: "Acme",
          adminEmail: "Corp admin@example.com",
        }) as never,
      ),
    );
  });

  it("survives a workspace name full of delimiters", async () => {
    const name = 'a "b" c\\d e.f';
    expect(await decode(await encode(session({ workspaceName: name })))).toMatchObject({
      workspaceName: name,
    });
  });

  it("survives a workspace name that is not ASCII", async () => {
    const name = "Café — 日本語";
    expect(await decode(await encode(session({ workspaceName: name })))).toMatchObject({
      workspaceName: name,
    });
  });
});

/**
 * The proxy that enforces read-only runs on the edge, where `node:crypto` and
 * `Buffer` do not exist. A stray import of either would only fail at runtime,
 * in production, on the path that enforces a security rule - so it is asserted
 * here instead.
 */
describe("edge safety", () => {
  // Comment lines are dropped first. Both files explain in prose why they avoid
  // these very things, and an assertion that trips on its own documentation
  // teaches nothing except to delete the documentation.
  const codeOf = (file: string) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), "utf8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return (
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("/*") &&
          !trimmed.startsWith("*")
        );
      })
      .join("\n");

  for (const file of ["impersonation-payload.ts", "impersonation-token.ts"]) {
    it(`${file} uses nothing that is missing on the edge`, () => {
      const code = codeOf(file);
      expect(code).not.toContain("node:crypto");
      // Not the bare word: ArrayBuffer is a Web standard and perfectly fine
      // here. What the edge lacks is Node's Buffer.
      expect(code).not.toContain("Buffer.from");
      expect(code).not.toContain("new Buffer");
      expect(code).not.toContain("server-only");
    });
  }
});
/**
 * Reading a session must never be able to break the application.
 *
 * `readImpersonation()` runs inside `getWorkspaceContext()`, which every page
 * and every API route depends on. A throw there takes the dashboard down over
 * an optional feature that is not in use on most requests.
 */
describe("failing safe", () => {
  it("treats no cookie as nobody impersonating, without reading the secret", async () => {
    // The secret used to be evaluated as an argument, so it was read - and
    // threw when unset - even with nothing to verify. An installation without
    // WIDGET_SIGNING_SECRET had every administrator's dashboard fail on a
    // feature nobody was using.
    const saved = process.env.WIDGET_SIGNING_SECRET;
    delete process.env.WIDGET_SIGNING_SECRET;
    try {
      const { decodeImpersonation } = await import("./impersonation");
      await expect(decodeImpersonation(undefined)).resolves.toBeNull();
      await expect(decodeImpersonation("")).resolves.toBeNull();
    } finally {
      if (saved) process.env.WIDGET_SIGNING_SECRET = saved;
    }
  });
});
