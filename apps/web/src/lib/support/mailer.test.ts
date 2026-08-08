import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { mailerConfigured, sendSupportEmail } from "./mailer";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
  vi.unstubAllGlobals();
});

describe("mailerConfigured", () => {
  it("is false with no provider", () => {
    delete process.env.SUPPORT_EMAIL_PROVIDER;
    expect(mailerConfigured()).toBe(false);
  });

  it("needs a from address as well as a key", () => {
    process.env.SUPPORT_EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "key";
    delete process.env.SUPPORT_EMAIL_FROM;
    expect(mailerConfigured()).toBe(false);
    process.env.SUPPORT_EMAIL_FROM = "support@example.com";
    expect(mailerConfigured()).toBe(true);
  });
});

describe("sendSupportEmail", () => {
  it("reports failure rather than throwing when unconfigured", async () => {
    // The caller records "notified" from this boolean; throwing here would
    // roll back an operator reply that was already saved.
    delete process.env.SUPPORT_EMAIL_PROVIDER;
    await expect(
      sendSupportEmail({ to: "a@b.com", subject: "s", text: "t" }),
    ).resolves.toBe(false);
  });

  it("swallows a provider outage", async () => {
    process.env.SUPPORT_EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "key";
    process.env.SUPPORT_EMAIL_FROM = "support@example.com";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(
      sendSupportEmail({ to: "a@b.com", subject: "s", text: "t" }),
    ).resolves.toBe(false);
  });

  it("reports success when the provider accepts it", async () => {
    process.env.SUPPORT_EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "key";
    process.env.SUPPORT_EMAIL_FROM = "support@example.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await expect(
      sendSupportEmail({ to: "a@b.com", subject: "s", text: "t" }),
    ).resolves.toBe(true);
  });
});
