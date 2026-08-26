import { describe, expect, it } from "vitest";
import { parsePastedUrls, pasteOrigin } from "./pasted-urls";

const ROOT = "https://site.test/";

describe("parsePastedUrls", () => {
  it("reads one URL per line", () => {
    const { urls } = parsePastedUrls(
      "https://site.test/a\nhttps://site.test/b",
      ROOT,
    );
    expect(urls).toEqual(["https://site.test/a", "https://site.test/b"]);
  });

  // Pasting bare paths is the natural thing to do when every URL shares a host.
  it("accepts bare paths", () => {
    const { urls } = parsePastedUrls("/hidden-page\n/another", ROOT);
    expect(urls).toEqual([
      "https://site.test/hidden-page",
      "https://site.test/another",
    ]);
  });

  it("ignores blank lines and surrounding whitespace", () => {
    const { urls } = parsePastedUrls("\n  /a  \n\n\n  /b\n", ROOT);
    expect(urls).toEqual(["https://site.test/a", "https://site.test/b"]);
  });

  it("handles Windows line endings", () => {
    const { urls } = parsePastedUrls("/a\r\n/b", ROOT);
    expect(urls).toHaveLength(2);
  });

  it("drops duplicates", () => {
    const { urls } = parsePastedUrls("/a\n/a\nhttps://site.test/a", ROOT);
    expect(urls).toEqual(["https://site.test/a"]);
  });

  // A fragment is a position on a page, not a different page. Left in, the same
  // page would be fetched and embedded once per anchor.
  it("strips fragments", () => {
    const { urls } = parsePastedUrls("/a#section-2", ROOT);
    expect(urls).toEqual(["https://site.test/a"]);
  });

  // A paste from a spreadsheet routinely carries a stray row. Failing the whole
  // submission over one bad line is a worse answer than taking the good ones
  // and reporting the count.
  it("skips off-site URLs without failing the rest", () => {
    const { urls, skipped } = parsePastedUrls(
      "/a\nhttps://elsewhere.test/x\n/b",
      ROOT,
    );
    expect(urls).toEqual(["https://site.test/a", "https://site.test/b"]);
    expect(skipped).toBe(1);
  });

  it("treats a different port or scheme as off-site", () => {
    const { urls, skipped } = parsePastedUrls(
      "http://site.test/a\nhttps://site.test:8443/b",
      ROOT,
    );
    expect(urls).toEqual([]);
    expect(skipped).toBe(2);
  });

  it("returns nothing when the source has no usable root", () => {
    expect(parsePastedUrls("/a", "not a url")).toEqual({ urls: [], skipped: 0 });
  });

  it("caps a runaway paste", () => {
    const huge = Array.from({ length: 6_000 }, (_, i) => `/p${i}`).join("\n");
    expect(parsePastedUrls(huge, ROOT).urls).toHaveLength(5_000);
  });
});

describe("pasteOrigin", () => {
  // The bug this exists for: the interface built its own example by appending
  // "/pricing" to the stored root URL. A root saved with a trailing slash
  // rendered "https://example.com//pricing" - an address that does not resolve,
  // shown to the operator as an example of correct usage.
  it("does not double the slash on a root stored with one", () => {
    expect(pasteOrigin("https://fileviewerhub.com/")).toBe(
      "https://fileviewerhub.com",
    );
  });

  it("is the same with or without the trailing slash", () => {
    expect(pasteOrigin("https://example.com")).toBe(
      pasteOrigin("https://example.com/"),
    );
  });

  // It has to agree with what the parser actually does, or the example is a
  // second implementation waiting to drift.
  it("matches where the parser puts a pasted path", () => {
    for (const root of ["https://example.com", "https://example.com/"]) {
      const shown = `${pasteOrigin(root)}/pricing`;
      expect(parsePastedUrls("/pricing", root).urls).toEqual([shown]);
    }
  });

  // A root with a path still resolves pasted paths against the origin, which is
  // what the parser does, so the example must say the same.
  it("drops a path on the root, as the parser does", () => {
    expect(pasteOrigin("https://example.com/docs/")).toBe("https://example.com");
  });

  it("returns null when there is no usable root", () => {
    expect(pasteOrigin(null)).toBeNull();
    expect(pasteOrigin("not a url")).toBeNull();
  });
});
