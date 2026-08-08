import { describe, expect, it } from "vitest";
import { normalizeUrlInput } from "./normalize-url";

describe("normalizeUrlInput", () => {
  it("adds https to a bare domain", () => {
    expect(normalizeUrlInput("example.com")).toBe("https://example.com");
    expect(normalizeUrlInput("www.example.com/blog")).toBe(
      "https://www.example.com/blog",
    );
  });

  it("leaves an explicit scheme alone", () => {
    expect(normalizeUrlInput("http://example.com")).toBe("http://example.com");
    expect(normalizeUrlInput("HTTPS://Example.com")).toBe("HTTPS://Example.com");
  });

  it("does not disguise an unsupported scheme as a domain", () => {
    // It must reach the protocol check as ftp:, not become https://ftp:...
    expect(normalizeUrlInput("ftp://files.example.com")).toBe(
      "ftp://files.example.com",
    );
  });

  it("does not let a javascript: payload through as a scheme", () => {
    // No "//", so it is not treated as a scheme; the https form then fails to
    // parse rather than being handed on as-is.
    const result = normalizeUrlInput("javascript:alert(1)");
    expect(result.startsWith("https://")).toBe(true);
    expect(() => new URL(result)).toThrow();
  });

  it("keeps a host:port readable as a host", () => {
    // Without the "//" requirement this would parse as scheme "localhost".
    expect(normalizeUrlInput("localhost:3000")).toBe("https://localhost:3000");
    expect(new URL(normalizeUrlInput("localhost:3000")).hostname).toBe(
      "localhost",
    );
  });

  it("handles protocol-relative input", () => {
    expect(normalizeUrlInput("//cdn.example.com")).toBe(
      "https://cdn.example.com",
    );
  });

  it("trims surrounding whitespace from a paste", () => {
    expect(normalizeUrlInput("  example.com  ")).toBe("https://example.com");
  });

  it("leaves an empty value empty", () => {
    expect(normalizeUrlInput("")).toBe("");
    expect(normalizeUrlInput("   ")).toBe("");
  });
});
