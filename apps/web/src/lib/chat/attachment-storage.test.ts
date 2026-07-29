import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readAttachment,
  removeAttachment,
  saveAttachment,
} from "./attachment-storage";

let temporaryDirectory: string | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (temporaryDirectory) {
    const resolved = path.resolve(temporaryDirectory);
    const temporaryRoot = path.resolve(tmpdir());
    if (resolved.startsWith(`${temporaryRoot}${path.sep}`)) {
      await rm(resolved, { recursive: true, force: true });
    }
    temporaryDirectory = undefined;
  }
});

describe("attachment storage", () => {
  it("stores a validated image under an opaque key", async () => {
    temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "docent-attachment-test-"),
    );
    vi.stubEnv("UPLOAD_DIR", temporaryDirectory);
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const file = new File([bytes], "example.png", { type: "image/png" });

    const stored = await saveAttachment(file, "image");

    expect(stored.storageKey).toMatch(/^[a-f0-9-]{36}\.png$/);
    await expect(readAttachment(stored.storageKey)).resolves.toEqual(
      Buffer.from(bytes),
    );
    await removeAttachment(stored.storageKey);
  });

  it("rejects active SVG content and unsupported image types", async () => {
    temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "docent-attachment-test-"),
    );
    vi.stubEnv("UPLOAD_DIR", temporaryDirectory);
    const file = new File(["<svg><script /></svg>"], "unsafe.svg", {
      type: "image/svg+xml",
    });

    await expect(saveAttachment(file, "image")).rejects.toMatchObject({
      code: "ATTACHMENT_INVALID",
    });
  });
});
