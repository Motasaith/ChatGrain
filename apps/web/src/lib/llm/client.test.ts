import { afterEach, describe, expect, it, vi } from "vitest";
import { generateGroundedAnswer } from "./client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("generateGroundedAnswer", () => {
  it("sends image content parts to an Ollama-compatible vision model", async () => {
    vi.stubEnv("LLM_BASE_URL", "http://127.0.0.1:11434/v1");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const userMessage = body.messages[1];
      expect(userMessage.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining("Do not dump OCR text"),
          }),
          {
            type: "image_url",
            image_url: {
              url: "data:image/png;base64,iVBORw0KGgo=",
            },
          },
        ]),
      );
      return Response.json({
        choices: [{ message: { content: "The image shows the support flow." } }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateGroundedAnswer({
        model: "gemma4:31b",
        systemPrompt: "Stay grounded.",
        context: "[1] Product page",
        question: "What workflow is shown?",
        temperature: 0.1,
        images: [
          {
            mimeType: "image/png",
            base64: "iVBORw0KGgo=",
          },
        ],
      }),
    ).resolves.toBe("The image shows the support flow.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
