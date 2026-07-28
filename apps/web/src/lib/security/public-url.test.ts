import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [
    {
      address: "93.184.216.34",
      family: 4,
    },
  ]),
}));

import { createSafeFetcher, safeFetch } from "./public-url";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("safeFetch", () => {
  it("retains cookies through a Clerk-style cross-origin handshake", async () => {
    const requests: Array<{ url: string; cookie: string | null }> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const cookie = new Headers(init?.headers).get("cookie");
        requests.push({ url: url.href, cookie });

        if (url.hostname === "accounts.example.dev") {
          return new Response(null, {
            status: 307,
            headers: {
              location:
                "https://example.com/?__clerk_handshake=signed-payload",
            },
          });
        }

        if (url.searchParams.has("__clerk_handshake")) {
          return new Response(null, {
            status: 307,
            headers: {
              location: "/",
              "set-cookie":
                "__clerk_session=ready; Path=/; Secure; HttpOnly; SameSite=None",
            },
          });
        }

        if (cookie?.includes("__clerk_session=ready")) {
          return new Response("<main>Public content</main>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }

        return new Response(null, {
          status: 307,
          headers: {
            location:
              "https://accounts.example.dev/handshake?redirect_url=https%3A%2F%2Fexample.com%2F",
          },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { response, finalUrl } = await safeFetch("https://example.com/");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Public content");
    expect(finalUrl.href).toBe("https://example.com/");
    expect(requests).toHaveLength(4);
    expect(requests[3].cookie).toContain("__clerk_session=ready");
  });

  it("does not forward one host's cookies to another host", async () => {
    const requests: Array<{ url: string; cookie: string | null }> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        requests.push({
          url: url.href,
          cookie: new Headers(init?.headers).get("cookie"),
        });

        if (url.hostname === "example.com") {
          return new Response(null, {
            status: 302,
            headers: {
              location: "https://other.example.net/final",
              "set-cookie": "private_session=secret; Path=/; Secure; HttpOnly",
            },
          });
        }

        return new Response("done", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { response } = await safeFetch("https://example.com/start");

    await expect(response.text()).resolves.toBe("done");
    expect(requests).toHaveLength(2);
    expect(requests[1].cookie).toBeNull();
  });

  it("reuses established cookies across requests in one crawl session", async () => {
    const cookies: Array<string | null> = [];
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const cookie = new Headers(init?.headers).get("cookie");
        cookies.push(cookie);
        return new Response("content", {
          status: 200,
          headers: {
            "content-type": "text/plain",
            ...(!cookie
              ? { "set-cookie": "crawl_session=ready; Path=/; Secure" }
              : {}),
          },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const fetchPublic = createSafeFetcher();

    await fetchPublic("https://example.com/first");
    await fetchPublic("https://example.com/second");

    expect(cookies).toEqual([null, "crawl_session=ready"]);
  });
});
