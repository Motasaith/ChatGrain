import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("widget embed loader", () => {
  it("includes first-visit teasers and returning-visitor attention state", async () => {
    const response = GET(new Request("https://docent.test/embed.js"));
    const source = await response.text();

    expect(source).toContain("data.teaserMessages");
    expect(source).toContain("data.attentionMessage");
    expect(source).toContain("docent:engaged:");
    expect(source).toContain("docent-teasers");
    expect(source).toContain("docent-attention");
  });
});
