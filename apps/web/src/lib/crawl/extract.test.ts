import { describe, expect, it } from "vitest";
import { extractBrand, extractPage } from "./extract";

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
});
