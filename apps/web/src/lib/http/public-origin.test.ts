import { describe, expect, it } from "vitest";
import { publicOrigin } from "./public-origin";

describe("publicOrigin", () => {
  // The bug: these values are concatenated with a path and printed for people
  // to copy and run. A trailing slash produced https://example.com//embed.js
  // inside a script tag on the developer page.
  it("strips a trailing slash", () => {
    expect(publicOrigin({ NEXT_PUBLIC_APP_URL: "https://example.com/" })).toBe(
      "https://example.com",
    );
  });

  it("strips a path as well", () => {
    expect(
      publicOrigin({ NEXT_PUBLIC_APP_URL: "https://example.com/app/" }),
    ).toBe("https://example.com");
  });

  it("prefers the more specific setting", () => {
    expect(
      publicOrigin({
        DOCENT_PUBLIC_URL: "https://public.example.com",
        NEXT_PUBLIC_APP_URL: "https://other.example.com",
      }),
    ).toBe("https://public.example.com");
  });

  it("skips a malformed setting rather than giving up on the next one", () => {
    expect(
      publicOrigin({
        DOCENT_PUBLIC_URL: "not a url",
        NEXT_PUBLIC_APP_URL: "https://example.com",
      }),
    ).toBe("https://example.com");
  });

  it("refuses a non-http protocol", () => {
    expect(publicOrigin({ NEXT_PUBLIC_APP_URL: "javascript:alert(1)" })).toBe(
      "http://localhost:3000",
    );
  });

  it("falls back when nothing is configured", () => {
    expect(publicOrigin({})).toBe("http://localhost:3000");
  });
});
