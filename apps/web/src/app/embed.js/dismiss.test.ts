import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The teaser prompts sit on a customer's own site, so a visitor must be able to
 * silence them. These assertions pin the parts that make the close button
 * actually work: it has to persist, it has to suppress the attention pill too,
 * and its click must not bubble into the row that opens the chat.
 */
const source = readFileSync(
  join(process.cwd(), "src/app/embed.js/route.ts"),
  "utf8",
);

describe("embedded widget teaser dismissal", () => {
  it("offers a labelled close control", () => {
    expect(source).toContain("docent-teasers-dismiss");
    expect(source).toContain("Dismiss chat suggestions");
  });

  it("remembers the choice across page loads", () => {
    // Without persistence the prompts return on every navigation and the
    // button looks broken.
    expect(source).toContain("docent:dismissed:");
    expect(source).toMatch(/localStorage\.setItem\('docent:dismissed:'/);
  });

  it("suppresses the attention pill as well as the teasers", () => {
    const fn = source.slice(
      source.indexOf("const dismissMessages"),
      source.indexOf("const renderClosedMessage"),
    );
    expect(fn).toContain("data-teasers");
    expect(fn).toContain("data-attention");
  });

  it("does not reopen the chat when the close button is clicked", () => {
    // The teaser row itself opens the chat, so the dismiss click must stop
    // propagating or closing the prompts would launch the widget.
    const handler = source.slice(
      source.indexOf("dismissButton.addEventListener"),
      source.indexOf("const chatIcon"),
    );
    expect(handler).toContain("stopPropagation");
  });

  it("keeps the control after the teaser list is rebuilt", () => {
    // replaceChildren() clears the container, so the button is re-appended.
    expect(source).toMatch(/replaceChildren\(\);\s*\n[^\n]*\n\s*teasers\.append\(dismissButton\)/);
  });
});
