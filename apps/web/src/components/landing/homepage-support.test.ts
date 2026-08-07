import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The homepage support widget is a fixed wrapper that sizes to its children.
 * The closed chat panel keeps its full height, so the wrapper is roughly
 * 390x630 in the corner - and a transparent box still captures clicks. On a
 * short viewport (a laptop, or any display scaled to 125%+) that box reaches
 * the header and silently swallows the "Sign in" and "Build an agent" buttons.
 *
 * These assertions pin the guards that keep it click-through, because the
 * failure is invisible: nothing errors, the buttons simply stop responding.
 */
const css = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

/** Returns the declaration body of a rule, matched as a literal selector. */
function rule(selector: string) {
  const needle = `${selector} {`;
  const at = css.indexOf(needle);
  if (at === -1) return "";
  const open = at + needle.length;
  const close = css.indexOf("}", open);
  return close === -1 ? "" : css.slice(open, close);
}

describe("homepage support widget hit testing", () => {
  it("does not let the wrapper capture clicks", () => {
    expect(rule(".home-support-widget")).toMatch(/pointer-events:\s*none/);
  });

  it("re-enables pointer events on the parts that are visible", () => {
    expect(rule(".home-support-widget > *")).toMatch(/pointer-events:\s*auto/);
  });

  it("keeps the closed panel inert and out of the tab order", () => {
    const closed = rule(".home-support-panel");
    expect(closed).toMatch(/pointer-events:\s*none/);
    // opacity alone leaves it focusable and hit-testable.
    expect(closed).toMatch(/visibility:\s*hidden/);
  });

  it("restores the panel when open", () => {
    const open = rule(".home-support-widget.is-open .home-support-panel");
    expect(open).toMatch(/pointer-events:\s*auto/);
    expect(open).toMatch(/visibility:\s*visible/);
  });
});
