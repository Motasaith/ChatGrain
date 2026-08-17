import { describe, expect, it } from "vitest";
import {
  chooseExtraction,
  extractBrand,
  extractPage,
  isSoftNotFound,
} from "./extract";

const pageUrl = new URL("https://example.com/docs/start");
const html = `<!doctype html>
  <html>
    <head>
      <title>Acme Docs</title>
      <meta name="theme-color" content="#285f45">
      <link rel="icon" href="/favicon.png">
    </head>
    <body>
      <nav>Navigation noise</nav>
      <main>
        <h1>Getting started</h1>
        <p>Acme helps teams answer customer questions with verified documentation.</p>
        <p>Install the product, connect a source, and publish the support widget.</p>
        <a href="/pricing?utm_source=test">Pricing</a>
      </main>
      <footer>Footer noise</footer>
    </body>
  </html>`;

describe("content extraction", () => {
  it("keeps main text and canonicalizes links", () => {
    const page = extractPage(html, pageUrl);
    expect(page.text).toContain("verified documentation");
    expect(page.text).not.toContain("Navigation noise");
    expect(page.links).toContain("https://example.com/pricing");
    expect(page.contentHash).toHaveLength(64);
  });

  it("detects basic brand metadata", () => {
    const brand = extractBrand(html, pageUrl);
    expect(brand.name).toBe("Acme Docs");
    expect(brand.primaryColor).toBe("#285f45");
    expect(brand.iconUrl).toBe("https://example.com/favicon.png");
  });

  it("captures and sanitizes an inline SVG logo", () => {
    const brand = extractBrand(
      `<html><head><title>ToolHive</title></head><body>
        <header><a aria-label="ToolHive home">
          <svg aria-label="ToolHive logo" viewBox="0 0 32 32" onclick="alert(1)">
            <script>alert(1)</script>
            <rect fill="#4f46e5" width="32" height="32" />
          </svg>
        </a></header>
      </body></html>`,
      pageUrl,
    );
    expect(brand.logoUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const decoded = Buffer.from(
      brand.logoUrl!.split(",")[1],
      "base64",
    ).toString("utf8");
    expect(decoded).toContain("#4f46e5");
    expect(decoded).not.toContain("<script");
    expect(decoded).not.toContain("onclick");
    expect(brand.primaryColor).toBe("#4f46e5");
  });

  it("prefers a touch icon when a separate logo is unavailable", () => {
    const brand = extractBrand(
      `<html><head>
        <title>Acme</title>
        <link rel="icon" href="/favicon.ico">
        <link rel="apple-touch-icon" href="/apple-icon.png">
      </head></html>`,
      pageUrl,
    );
    expect(brand.logoUrl).toBeUndefined();
    expect(brand.iconUrl).toBe("https://example.com/apple-icon.png");
  });

  it("detects a soft 404 returned with HTTP 200", () => {
    expect(
      isSoftNotFound(
        "<html><head><title>Not Found | Acme</title></head><body>Loading</body></html>",
      ),
    ).toBe(true);
    expect(isSoftNotFound(html)).toBe(false);
  });
});

describe("HTML entity decoding", () => {
  it("removes entities that survive parsing", () => {
    // Double-encoded source: the parser decodes `&amp;amp;` to `&amp;`, which
    // then reaches the index and the model as literal text.
    const page = extractPage(
      `<html><head><title>Cambridge News &amp;amp; Updates</title></head>
       <body><main><p>${"Bell Lab opens in Cambridge News &amp;amp; Updates today. ".repeat(6)}</p></main></body></html>`,
      new URL("https://example.test/news"),
    );
    expect(page.title).toBe("Cambridge News & Updates");
    expect(page.text).toContain("News & Updates");
    expect(page.text).not.toContain("&amp;");
  });

  it("leaves an ordinary ampersand alone", () => {
    const page = extractPage(
      `<html><head><title>Tom & Jerry</title></head>
       <body><main><p>${"Support for Tom & Jerry is available every weekday. ".repeat(6)}</p></main></body></html>`,
      new URL("https://example.test/plain"),
    );
    expect(page.title).toBe("Tom & Jerry");
    expect(page.text).toContain("Tom & Jerry");
  });
});

describe("card and grid page extraction", () => {
  it("recovers sections Readability discards", () => {
    // Shaped like a calculator explainer: one prose block plus several cards
    // carrying the details people actually ask about. Readability keeps the
    // prose and throws the cards away.
    const cards = [
      "Formula and calculation methods. Total seconds = Days times 86400 plus Hours times 3600 plus Minutes times 60 plus Seconds.",
      "Time addition and subtraction. Accumulate hours, minutes and seconds, then convert carryover so ninety minutes becomes one hour and thirty minutes.",
      "Decimal conversion. Convert a time value to a fraction of a larger unit, so one hour and thirty minutes is one point five hours.",
    ]
      .map((text) => `<div class="card"><p>${text}</p></div>`)
      .join("");
    const page = extractPage(
      `<html><head><title>Time calculator</title></head><body>
         <nav>Home Calculators Blog</nav>
         <main><article><p>${"Time uses a base-60 system rather than decimal. ".repeat(8)}</p></article>
         <section class="grid">${cards}</section></main>
         <footer>Copyright</footer>
       </body></html>`,
      new URL("https://example.test/calculators/time"),
    );

    expect(page.text).toContain("Total seconds = Days times 86400");
    expect(page.text).toContain("Decimal conversion");
    // Stripped chrome must not come back with them.
    expect(page.text).not.toContain("Home Calculators Blog");
    expect(page.text).not.toContain("Copyright");
  });

  it("leaves a normal article to Readability", () => {
    const body = "The refund window is thirty days from delivery. ".repeat(40);
    const page = extractPage(
      `<html><head><title>Refunds</title></head><body>
         <main><article><p>${body}</p></article></main>
       </body></html>`,
      new URL("https://example.test/refunds"),
    );
    expect(page.text).toContain("refund window is thirty days");
  });
});

describe("block boundaries", () => {
  it("keeps adjacent blocks from welding into one token", () => {
    // The shape that produced "2See it instantlyOur client-side parser reads":
    // a counter, a heading and a paragraph as siblings. `textContent` returns
    // them with no separator at all, so the words never exist as themselves in
    // the index and no query can match them.
    const page = extractPage(
      `<html><head><title>Viewer</title></head><body><main>
         <div class="step"><span class="num">2</span><h3>See it instantly</h3>
           <p>Our parser reads the message directly on your device.</p></div>
       </main></body></html>`,
      new URL("https://example.test/viewer"),
    );

    expect(page.text).not.toContain("instantlyOur");
    expect(page.text).not.toContain("2See");
    expect(page.text).toContain("See it instantly");
  });

  it("keeps list items and table cells separately searchable", () => {
    const page = extractPage(
      `<html><head><title>Formats</title></head><body><main>
         <ul><li>EML</li><li>MSG</li><li>MBOX</li></ul>
         <table><tr><th>Format</th><th>Supported</th></tr>
                <tr><td>HEIC</td><td>Yes</td></tr></table>
       </main></body></html>`,
      new URL("https://example.test/formats"),
    );

    // "EMLMSGMBOX" is one token, so a search for "EML" cannot find this page.
    expect(page.text).not.toMatch(/EMLMSG|MSGMBOX|HEICYes/);
    for (const format of ["EML", "MSG", "MBOX", "HEIC"]) {
      expect(page.text).toMatch(
        new RegExp(`(?:^|[^A-Za-z])${format}(?:[^A-Za-z]|$)`),
      );
    }
  });

  it("keeps the blank line chunking splits on", () => {
    const page = extractPage(
      `<html><head><title>Two</title></head><body><main>
         <p>First paragraph about refunds.</p>
         <p>Second paragraph about delivery.</p>
       </main></body></html>`,
      new URL("https://example.test/two"),
    );
    expect(page.text).toContain("\n\n");
  });
});

describe("chooseExtraction", () => {
  it("keeps Readability when it captured most of the page", () => {
    expect(chooseExtraction("a".repeat(90), "a".repeat(100))).toBe("a".repeat(90));
  });

  it("prefers the fuller reading when Readability dropped most of it", () => {
    const full = "b".repeat(100);
    expect(chooseExtraction("b".repeat(20), full)).toBe(full);
  });

  it("handles either side being empty", () => {
    expect(chooseExtraction("", "only")).toBe("only");
    expect(chooseExtraction("only", "")).toBe("only");
  });
});
