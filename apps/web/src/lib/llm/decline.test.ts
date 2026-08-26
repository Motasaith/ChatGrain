import { describe, expect, it, vi, afterEach } from "vitest";
import { writeDecline } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * The decline is the reply a visitor gets when the site cannot answer them, so
 * its failure mode matters more than its wording: a broken provider must cost
 * the phrasing, never the reply. Returning null is how the caller knows to use
 * the operator's own message instead.
 */
describe("writeDecline", () => {
  it("returns null for an empty question rather than asking the model", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await writeDecline({ question: "   ", agentName: "A", topics: [] })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when the provider refuses", async () => {
    vi.stubEnv("LLM_PROVIDERS", "");
    vi.stubEnv("LLM_BASE_URL", "https://llm.test/v1");
    vi.stubEnv("LLM_MODEL", "test-model");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    expect(
      await writeDecline({ question: "how is the weather", agentName: "A", topics: [] }),
    ).toBeNull();
  });

  it("returns null when the provider answers with nothing", async () => {
    vi.stubEnv("LLM_PROVIDERS", "");
    vi.stubEnv("LLM_BASE_URL", "https://llm.test/v1");
    vi.stubEnv("LLM_MODEL", "test-model");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    expect(
      await writeDecline({ question: "how is the weather", agentName: "A", topics: [] }),
    ).toBeNull();
  });

  it("returns null when the request throws", async () => {
    vi.stubEnv("LLM_PROVIDERS", "");
    vi.stubEnv("LLM_BASE_URL", "https://llm.test/v1");
    vi.stubEnv("LLM_MODEL", "test-model");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(
      await writeDecline({ question: "how is the weather", agentName: "A", topics: [] }),
    ).toBeNull();
  });

  it("passes the site's own topics, and never invents any", async () => {
    vi.stubEnv("LLM_PROVIDERS", "");
    vi.stubEnv("LLM_BASE_URL", "https://llm.test/v1");
    vi.stubEnv("LLM_MODEL", "test-model");
    let sentBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: { body: string }) => {
        sentBody = init.body;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "I can't help with that." } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    await writeDecline({
      question: "how to make coffee",
      agentName: "Sudo Scout",
      topics: ["CasaOS guide", "Penpot guide"],
    });
    expect(sentBody).toContain("CasaOS guide");
    expect(sentBody).toContain("Never invent a topic");
    expect(sentBody).toContain("Never answer the question");
  });
});
