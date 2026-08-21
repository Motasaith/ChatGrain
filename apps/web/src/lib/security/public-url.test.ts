import { afterEach, describe, expect, it, vi } from "vitest";
const dnsResult = vi.hoisted(() => ({ address: "93.184.216.34" }));

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [
    {
      address: dnsResult.address,
      family: 4,
    },
  ]),
}));

import {
  createSafeFetcher,
  safeFetch,
  validatePublicUrl,
} from "./public-url";

afterEach(() => {
  dnsResult.address = "93.184.216.34";
  vi.unstubAllGlobals();
});

describe("safeFetch", () => {
  it("keeps private network URLs blocked by default", async () => {
    dnsResult.address = "127.0.0.1";

    await expect(validatePublicUrl("http://localhost:3000")).rejects.toMatchObject({
      code: "PRIVATE_URL_BLOCKED",
    });
  });

  it("allows a private URL only when an internal caller opts in", async () => {
    dnsResult.address = "127.0.0.1";

    await expect(
      validatePublicUrl("http://localhost:3000", { allowPrivate: true }),
    ).resolves.toMatchObject({
      hostname: "localhost",
      port: "3000",
    });
  });

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

describe("truncated responses", () => {
  it("refuses a body shorter than the length it promised", async () => {
    // The dangerous failure, because nothing downstream can detect it:
    // extraction happily produces text from half a page and indexes it as
    // though it were whole. No checkpoint or retry ever notices.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("only-part", {
          status: 200,
          headers: { "content-type": "text/html", "content-length": "5000" },
        }),
      ),
    );

    await expect(safeFetch(new URL("https://example.com/page"))).rejects.toThrow(
      /incomplete/i,
    );
  });

  it("accepts a complete body", async () => {
    const body = "<html><body>complete</body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(body, {
          status: 200,
          headers: {
            "content-type": "text/html",
            "content-length": String(body.length),
          },
        }),
      ),
    );

    const { response } = await safeFetch(new URL("https://example.com/page"));
    expect(await response.text()).toBe(body);
  });

  it("ignores the comparison when the body is compressed", async () => {
    // With compression the header describes the compressed size while the
    // bytes read are decompressed, so the two are not comparable and a
    // mismatch means nothing.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("decompressed content is longer than the header claims", {
          status: 200,
          headers: {
            "content-type": "text/html",
            "content-length": "9",
            "content-encoding": "gzip",
          },
        }),
      ),
    );

    const { response } = await safeFetch(new URL("https://example.com/page"));
    expect(await response.text()).toContain("decompressed");
  });
});
