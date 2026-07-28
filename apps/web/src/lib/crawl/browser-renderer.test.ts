import { describe, expect, it } from "vitest";
import { needsBrowserRendering } from "./browser-renderer";

describe("needsBrowserRendering", () => {
  it("detects an empty Next.js app shell", () => {
    expect(
      needsBrowserRendering(
        '<main>Loading</main><script>self.__next_f.push([1,"payload"])</script>',
        "Loading",
      ),
    ).toBe(true);
  });

  it("keeps useful server-rendered pages on the fast path", () => {
    expect(
      needsBrowserRendering(
        '<main id="app">Server-rendered knowledge content</main>',
        "A".repeat(120),
      ),
    ).toBe(false);
  });

  it("does not launch a browser for a short static page", () => {
    expect(
      needsBrowserRendering("<main>Small public notice</main>", "Small public notice"),
    ).toBe(false);
  });
});
