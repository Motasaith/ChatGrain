import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { transcribeAudio } from "./transcribe";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("transcribeAudio", () => {
  it("uses the configured whisper.cpp inference endpoint", async () => {
    vi.stubEnv("WHISPER_BASE_URL", "http://127.0.0.1:8080/");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      return Response.json({ text: "multilingual voice transcript" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["audio"], "voice.webm", { type: "audio/webm" });

    await expect(transcribeAudio(file)).resolves.toBe(
      "multilingual voice transcript",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/inference",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns null without a configured transcription service", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["audio"], "voice.webm", { type: "audio/webm" });

    await expect(transcribeAudio(file)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
