import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  secretsConfigured,
} from "./secrets";

const KEY = Buffer.alloc(32, 7).toString("base64");
const original = process.env.SECRET_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.SECRET_ENCRYPTION_KEY = KEY;
});
afterEach(() => {
  if (original === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
  else process.env.SECRET_ENCRYPTION_KEY = original;
});

describe("encryptSecret", () => {
  it("round-trips a key", () => {
    const secret = "gsk_live_abcdef123456";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("produces different ciphertext each time", () => {
    // A fixed IV would make identical keys recognisable across rows.
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("never contains the plaintext", () => {
    expect(encryptSecret("gsk_supersecret")).not.toContain("supersecret");
  });

  it("refuses to run without a key rather than storing plaintext", () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/SECRET_ENCRYPTION_KEY/);
    expect(secretsConfigured()).toBe(false);
  });

  it("rejects a key of the wrong length", () => {
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});

describe("decryptSecret", () => {
  it("returns null for tampered ciphertext instead of rubbish", () => {
    // GCM authenticates, so a flipped byte fails rather than decoding wrongly.
    const encrypted = encryptSecret("gsk_live_abcdef123456");
    const parts = encrypted.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(decryptSecret(parts.join(":"))).toBeNull();
  });

  it("returns null under a rotated key rather than throwing", () => {
    // One unreadable row must not take down every answer for that agent.
    const encrypted = encryptSecret("secret");
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(decryptSecret(encrypted)).toBeNull();
  });

  it("handles empty, malformed and unversioned input", () => {
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret("")).toBeNull();
    expect(decryptSecret("not-encrypted")).toBeNull();
    expect(decryptSecret("v9:a:b:c")).toBeNull();
  });
});

describe("maskSecret", () => {
  it("shows enough to recognise but not to use", () => {
    expect(maskSecret("gsk_live_abcdef123456")).toBe("gsk_…3456");
  });

  it("reveals nothing of a short value", () => {
    expect(maskSecret("short")).toBe("•••••");
  });
});
