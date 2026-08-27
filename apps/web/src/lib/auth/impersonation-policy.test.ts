import { describe, expect, it } from "vitest";
import {
  decideImpersonatedWrite,
  sandboxAllowsWrite,
} from "./impersonation-policy";

/**
 * The sandbox boundary, which is the whole of the promise made to a customer.
 *
 * The banner tells an administrator that nothing they do in a sandbox reaches
 * the customer's account, and tells the customer the same thing. If this
 * allowlist is wrong in the permissive direction, both statements are false and
 * neither party has any way to notice - the write simply succeeds. So the cases
 * below are mostly about what is *refused*.
 */

const decide = (over: Partial<Parameters<typeof decideImpersonatedWrite>[0]>) =>
  decideImpersonatedWrite({
    method: "POST",
    pathname: "/api/agents/abc",
    mode: "sandbox",
    workspaceName: "Acme",
    ...over,
  });

describe("sandbox writes", () => {
  it("permits a chat turn, which is the point of the tier", () => {
    expect(sandboxAllowsWrite("/api/chat/agent-123")).toBe(true);
    expect(decide({ pathname: "/api/chat/agent-123" }).allowed).toBe(true);
  });

  it("permits the conversation lifecycle the widget uses", () => {
    expect(
      sandboxAllowsWrite("/api/public/agents/a1/conversations"),
    ).toBe(true);
    expect(
      sandboxAllowsWrite("/api/public/agents/a1/conversations/c1"),
    ).toBe(true);
  });

  // Everything below is something the customer owns. A sandbox that could touch
  // any of it would not be a sandbox.
  it.each([
    ["an agent's settings", "/api/agents/a1"],
    ["a source", "/api/agents/a1/sources"],
    ["a workspace", "/api/workspace"],
    ["an action", "/api/actions/x1"],
    ["a document", "/api/documents/d1"],
    ["the admin routes", "/api/admin/workspaces/w1"],
  ])("refuses %s", (_label, pathname) => {
    expect(sandboxAllowsWrite(pathname)).toBe(false);
    const decision = decide({ pathname });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("IMPERSONATION_SANDBOX");
    }
  });

  // A ticket notifies the customer's support address and a lead lands in the
  // list their sales people work from. Both leave the building, and an effect
  // that has already been delivered cannot be discarded when the session ends.
  it("refuses tickets and leads even though they sit under a writable prefix", () => {
    expect(sandboxAllowsWrite("/api/public/agents/a1/tickets")).toBe(false);
    expect(sandboxAllowsWrite("/api/public/agents/a1/leads")).toBe(false);
  });

  it("explains which tier refused, so it does not read as a fault", () => {
    const decision = decide({ pathname: "/api/agents/a1" });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.message).toContain("sandbox");
      expect(decision.message).toContain("Acme");
      // Names the way forward, or the next thing an administrator does is ask
      // for full write access they did not need.
      expect(decision.message).toContain("request");
    }
  });
});

describe("the other two tiers", () => {
  it("lets reads through at every tier", () => {
    for (const mode of ["read", "sandbox", "write"] as const) {
      expect(decide({ method: "GET", mode }).allowed).toBe(true);
      expect(decide({ method: "HEAD", mode }).allowed).toBe(true);
    }
  });

  it("refuses every write in a read session", () => {
    const decision = decide({ mode: "read", pathname: "/api/chat/agent-123" });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("IMPERSONATION_READ_ONLY");
      // Points at the tier that would work, rather than only saying no.
      expect(decision.message).toContain("sandbox");
    }
  });

  it("permits anything in a write session, which the customer approved", () => {
    expect(decide({ mode: "write", pathname: "/api/agents/a1" }).allowed).toBe(
      true,
    );
  });

  // The exit cannot be behind the lock, or a session can only be left by
  // waiting out its expiry or clearing cookies by hand.
  it("never blocks the way out", () => {
    for (const mode of ["read", "sandbox", "write"] as const) {
      expect(
        decide({
          method: "DELETE",
          pathname: "/api/admin/impersonate",
          mode,
        }).allowed,
      ).toBe(true);
    }
  });

  // A prefix match on "/api/chat/" must not be satisfied by a path that merely
  // begins with something similar.
  it("does not match a lookalike prefix", () => {
    expect(sandboxAllowsWrite("/api/chatsettings")).toBe(false);
    expect(sandboxAllowsWrite("/api/publicity/agents/a1")).toBe(false);
  });
});
