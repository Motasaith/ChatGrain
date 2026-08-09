import { describe, expect, it } from "vitest";
import { parseEnv, redactEnv, syncEnv } from "./env-sync";

const template = `# Web
NEXT_PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=postgres://docent:docent@127.0.0.1:5434/docent

# Crawler
CRAWL_CONCURRENCY=6
WIDGET_SIGNING_SECRET=replace-with-at-least-32-random-characters`;

describe("syncEnv", () => {
  it("keeps existing values and adds what the template introduced", () => {
    const result = syncEnv(template, "NEXT_PUBLIC_APP_URL=https://chatgrain.com");
    expect(result.contents).toContain(
      "NEXT_PUBLIC_APP_URL=https://chatgrain.com",
    );
    expect(result.contents).toContain("CRAWL_CONCURRENCY=6");
    expect(result.added).toContain("CRAWL_CONCURRENCY");
    expect(result.kept).toEqual(["NEXT_PUBLIC_APP_URL"]);
  });

  it("preserves the template's comments and order", () => {
    const result = syncEnv(template, "CRAWL_CONCURRENCY=2");
    const lines = result.contents.split("\n");
    expect(lines[0]).toBe("# Web");
    expect(lines.indexOf("# Crawler")).toBeGreaterThan(
      lines.findIndex((l) => l.startsWith("DATABASE_URL=")),
    );
  });

  it("keeps a deliberately emptied value rather than restoring the default", () => {
    // Blanking a key is how a feature is turned off. Refilling it from the
    // template would switch it back on without anyone asking.
    const result = syncEnv(template, "CRAWL_CONCURRENCY=");
    expect(result.contents).toContain("CRAWL_CONCURRENCY=");
    expect(result.contents).not.toContain("CRAWL_CONCURRENCY=6");
  });

  it("carries over keys the template does not mention", () => {
    const result = syncEnv(template, "MY_LOCAL_FLAG=1");
    expect(result.extra).toEqual(["MY_LOCAL_FLAG"]);
    expect(result.contents).toContain("MY_LOCAL_FLAG=1");
  });

  it("does not treat a comment as an assignment", () => {
    const result = syncEnv("# CRAWL_CONCURRENCY=6\nLOG_LEVEL=info", "");
    expect(result.added).toEqual(["LOG_LEVEL"]);
  });

  it("handles an empty target file", () => {
    const result = syncEnv(template, "");
    expect(result.kept).toEqual([]);
    expect(result.added).toHaveLength(4);
  });

  it("keeps a value containing an equals sign intact", () => {
    const result = syncEnv(
      "SMTP_URL=",
      "SMTP_URL=smtp://user:p=ss@host:587",
    );
    expect(result.contents).toBe("SMTP_URL=smtp://user:p=ss@host:587");
  });
});

describe("parseEnv", () => {
  it("ignores comments and blank lines", () => {
    const values = parseEnv("# note\n\nA=1\n  B=2  ");
    expect([...values.keys()]).toEqual(["A", "B"]);
  });
});

describe("redactEnv", () => {
  it("empties secrets but keeps ordinary defaults", () => {
    const redacted = redactEnv(
      [
        "CRAWL_CONCURRENCY=2",
        "CLERK_SECRET_KEY=sk_live_abc",
        "LLM_GROQ_API_KEY=gsk_abc",
        "SENTRY_DSN=https://abc@sentry.io/1",
        "DATABASE_URL=postgres://user:pass@host/db",
      ].join("\n"),
    );
    expect(redacted).toContain("CRAWL_CONCURRENCY=2");
    expect(redacted).toContain("CLERK_SECRET_KEY=");
    expect(redacted).not.toContain("sk_live_abc");
    expect(redacted).not.toContain("gsk_abc");
    expect(redacted).not.toContain("sentry.io/1");
    expect(redacted).not.toContain("pass@host");
  });

  it("leaves an already-empty secret alone", () => {
    expect(redactEnv("CLERK_SECRET_KEY=")).toBe("CLERK_SECRET_KEY=");
  });

  it("keeps comments", () => {
    expect(redactEnv("# a note\nA=1")).toContain("# a note");
  });
});
