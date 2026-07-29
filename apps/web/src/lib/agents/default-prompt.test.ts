import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_SYSTEM_PROMPT,
  defaultAgentSystemPrompt,
} from "./default-prompt";

describe("default agent prompt", () => {
  it("uses the new agent identity and its own website", () => {
    const prompt = defaultAgentSystemPrompt({
      agentName: "Raspberry Support",
      websiteUrl: "https://projects-raspberry.com",
    });
    expect(prompt).toContain(
      "Raspberry Support, the support assistant for https://projects-raspberry.com",
    );
    expect(prompt).toContain("direct clickable link");
    expect(prompt).toContain("specific number of items");
  });

  it("does not contain copied third-party identities or domains", () => {
    expect(DEFAULT_AGENT_SYSTEM_PROMPT).not.toMatch(
      /chatbase|botpress|duino4projects|pic-microcontroller/i,
    );
  });
});
