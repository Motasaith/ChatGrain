import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

describe("chunkText", () => {
  it("creates ordered overlapping chunks", () => {
    const input = Array.from(
      { length: 30 },
      (_, index) =>
        `Sentence ${index + 1} explains the refund and billing policy in useful detail.`,
    ).join(" ");
    const chunks = chunkText(input, 240, 50);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.map((chunk) => chunk.position)).toEqual(
      chunks.map((_, index) => index),
    );
    expect(chunks.every((chunk) => chunk.content.length >= 40)).toBe(true);
    expect(chunks[1].content).toContain(
      chunks[0].content.slice(-50).trim().split(" ").slice(-3).join(" "),
    );
  });

  it("returns no empty chunks", () => {
    expect(chunkText(" \n\n ")).toEqual([]);
  });
});
