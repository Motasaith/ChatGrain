import { describe, expect, it } from "vitest";
import { needsBrowserRendering } from "./browser-renderer";

const shell = (marker: string) =>
  `<html><body><div id="wrap"></div>${marker}</body></html>`;
const REAL_PAGE = `<html><body><article>${"Real prose about the product. ".repeat(60)}</article></body></html>`;

describe("needsBrowserRendering", () => {
  // A page that already has text is never re-fetched in a browser, whatever it
  // is built with. Rendering an ordinary page is pure cost.
  it("leaves a page that already has content alone", () => {
    expect(needsBrowserRendering(REAL_PAGE, "x".repeat(5_000))).toBe(false);
  });

  it("recognises the common client-side frameworks", () => {
    const cases: Array<[string, string]> = [
      ["Next.js", '<script>self.__next_f.push([1,"x"])</script>'],
      ["React", '<div data-reactroot=""></div>'],
      ["Angular", "<app-root></app-root>"],
      ["Nuxt", '<script>window.__NUXT__={}</script>'],
      ["Gatsby", '<div id="___gatsby"></div>'],
      ["SvelteKit", '<script>__sveltekit_1a2b3c = {}</script>'],
      ["Remix", "<script>window.__remixContext = {}</script>"],
      ["Vue", '<div data-v-app></div>'],
      ["generic mount point", '<div id="root"></div>'],
    ];
    for (const [name, marker] of cases) {
      expect(needsBrowserRendering(shell(marker), "tiny"), name).toBe(true);
    }
  });

  // Found against todomvc.com, which mounts React on
  // <section class="todoapp" id="root">. The pattern was hardcoded to <div>, so
  // a page with literally zero text was read as an ordinary page and indexed as
  // nothing at all - the worst possible miss, and silent.
  it("recognises a mount point on an element that is not a div", () => {
    const real = '<html><body><section class="todoapp" id="root"></section></body></html>';
    expect(needsBrowserRendering(real, "")).toBe(true);
    for (const tag of ["main", "article", "span", "my-app"]) {
      expect(
        needsBrowserRendering(`<html><body><${tag} id="app"></${tag}></body></html>`, ""),
        tag,
      ).toBe(true);
    }
  });

  it("does not render an empty page with no framework fingerprint", () => {
    // Nothing to infer from, so it is left alone. This is the case the manual
    // "always" setting exists for.
    expect(needsBrowserRendering("<html><body></body></html>", "")).toBe(false);
  });

  describe("the operator's override", () => {
    it("renders anything when set to always", () => {
      expect(needsBrowserRendering(REAL_PAGE, "x".repeat(5_000), "always")).toBe(true);
      expect(needsBrowserRendering("<html></html>", "", "always")).toBe(true);
    });

    it("renders nothing when set to never", () => {
      const spa = shell('<script>self.__next_f.push([1,"x"])</script>');
      expect(needsBrowserRendering(spa, "tiny", "never")).toBe(false);
    });

    it("detects as before when set to auto", () => {
      const spa = shell('<div id="root"></div>');
      expect(needsBrowserRendering(spa, "tiny", "auto")).toBe(true);
      expect(needsBrowserRendering(REAL_PAGE, "x".repeat(5_000), "auto")).toBe(false);
    });
  });
});
