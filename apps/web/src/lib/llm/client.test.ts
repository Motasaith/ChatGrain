import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeImagesForSearch,
  generateGroundedAnswer,
} from "./client";

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
    ).resolves.toEqual({
      status: "answered",
      text: "The image shows the support flow.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("describeImagesForSearch", () => {
  it("extracts a short visual query before website retrieval", async () => {
    vi.stubEnv("LLM_BASE_URL", "http://127.0.0.1:11434/v1");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.temperature).toBe(0);
        expect(body.messages[0].content).toContain(
          "Read the exact visible article",
        );
        expect(body.messages[1].content).toEqual(
          expect.arrayContaining([
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,aW1hZ2U=",
              },
            },
          ]),
        );
        return Response.json({
          choices: [
            {
              message: {
                content:
                  "Water Tank Overflow Alarm DIY Raspberry Pi Alert Guide LM324 CD4011",
              },
            },
          ],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      describeImagesForSearch({
        model: "gemma4:31b",
        images: [{ mimeType: "image/png", base64: "aW1hZ2U=" }],
      }),
    ).resolves.toBe(
      "Water Tank Overflow Alarm DIY Raspberry Pi Alert Guide LM324 CD4011",
    );
  });
});

describe("declining on insufficient evidence", () => {
  it("reports a refusal as a verdict, not a provider failure", async () => {
    // The caller has to tell these apart: a refusal means say so, an outage
    // means fall back. Collapsing both to null is what turned "we do not
    // support DWG" into a pasted list of every other viewer on the site.
    vi.stubEnv("LLM_BASE_URL", "http://127.0.0.1:11434/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: "NOT_ENOUGH_EVIDENCE" } }],
        }),
      ),
    );

    await expect(
      generateGroundedAnswer({
        model: "gemma4:31b",
        systemPrompt: "Stay grounded.",
        context: "[1] CSV Viewer\nView CSV and TSV spreadsheets.",
        question: "Can you open a .dwg CAD file?",
        temperature: 0.1,
      }),
    ).resolves.toEqual({ status: "declined" });
  });

  it("reports an unreachable provider as unavailable", async () => {
    vi.stubEnv("LLM_BASE_URL", "http://127.0.0.1:11434/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    await expect(
      generateGroundedAnswer({
        model: "gemma4:31b",
        systemPrompt: "Stay grounded.",
        context: "[1] CSV Viewer",
        question: "Anything?",
        temperature: 0.1,
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
