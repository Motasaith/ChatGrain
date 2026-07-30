import { describe, expect, it } from "vitest";
import { extractBrand, extractPage, isSoftNotFound } from "./extract";

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
