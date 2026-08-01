import { afterEach, describe, expect, it } from "vitest";
import { GET, resolveEmbedOrigin } from "./route";

const originalEnvironment = {
  DOCENT_PUBLIC_URL: process.env.DOCENT_PUBLIC_URL,
  APP_URL: process.env.APP_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("widget embed loader", () => {
  it("includes first-visit teasers and returning-visitor attention state", async () => {
    const response = GET(new Request("https://docent.test/embed.js"));
    const source = await response.text();

    expect(source).toContain("data.teaserMessages");
    expect(source).toContain("data.attentionMessage");
    expect(source).toContain("docent:engaged:");
    expect(source).toContain("docent-teasers");
    expect(source).toContain("docent-attention");
    expect(source).toContain("new URL(current.src, document.baseURI).origin");
  });

  it("prefers the configured public application URL", () => {
    process.env.DOCENT_PUBLIC_URL = "https://support.example.com/app";

    expect(
      resolveEmbedOrigin(new Request("http://localhost:5000/embed.js")),
    ).toBe("https://support.example.com");
  });

  it("uses trusted reverse-proxy headers when no public URL is configured", () => {
    delete process.env.DOCENT_PUBLIC_URL;
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;

    expect(
      resolveEmbedOrigin(
        new Request("http://localhost:5000/embed.js", {
          headers: {
            "x-forwarded-host": "support.example.com",
            "x-forwarded-proto": "https",
          },
        }),
      ),
    ).toBe("https://support.example.com");
  });
});
