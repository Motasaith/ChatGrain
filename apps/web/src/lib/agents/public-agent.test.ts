import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { domainAllowed, normalizeHost } from "@/lib/security/widget-token";

/**
 * Mirrors how `publicAgentData` resolves which domain a request came from.
 *
 * Browsers omit `Origin` on same-origin GETs, and strict tracking protection
 * can strip `Referer`, so first-party requests used to arrive with no domain
 * evidence at all and were rejected as if they came from another site.
 */
function resolveRequestingHost(headers: Record<string, string>) {
  const requestingUrl = headers.origin || headers.referer || "";
  const servingHost = headers["x-forwarded-host"] || headers.host || "";
  return normalizeHost(requestingUrl || servingHost);
}

const allowed = ["chatgrain.com"];

describe("requesting host resolution", () => {
  it("allows a same-origin request that carries neither origin nor referer", () => {
    const host = resolveRequestingHost({ host: "chatgrain.com" });
    expect(host).toBe("chatgrain.com");
    expect(domainAllowed(host, allowed)).toBe(true);
  });

  it("uses the proxied host when behind a reverse proxy", () => {
    const host = resolveRequestingHost({
      host: "127.0.0.1:3000",
      "x-forwarded-host": "chatgrain.com",
    });
    expect(domainAllowed(host, allowed)).toBe(true);
  });

  it("still rejects a genuine cross-origin embed", () => {
    // A real third-party embed always carries Origin, so the allowlist holds.
    const host = resolveRequestingHost({
      origin: "https://evil.test",
      host: "chatgrain.com",
    });
    expect(host).toBe("evil.test");
    expect(domainAllowed(host, allowed)).toBe(false);
  });

  it("prefers origin over the serving host", () => {
    expect(
      resolveRequestingHost({
        origin: "https://partner.test",
        host: "chatgrain.com",
      }),
    ).toBe("partner.test");
  });

  it("falls back to referer before the serving host", () => {
    expect(
      resolveRequestingHost({
        referer: "https://chatgrain.com/pricing",
        host: "internal.local",
      }),
    ).toBe("chatgrain.com");
  });
});
