import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopyButton } from "./copy-button";

/**
 * The copy button, as it arrives from the server.
 *
 * Only the first paint can be checked here - there is no DOM environment, so
 * clicking is out of reach. That still covers the failure this replaced: the
 * previous button was `onClick={() => navigator.clipboard.writeText(text)}`
 * with no label change, so it looked identical whether it had worked, silently
 * failed, or thrown because `navigator.clipboard` does not exist over plain
 * HTTP. What is asserted below is that the states exist at all and that the
 * button announces itself.
 */
describe("the copy button", () => {
  const markup = renderToStaticMarkup(<CopyButton text="hello" />);

  it("starts in its idle state", () => {
    expect(markup).toContain("is-idle");
    expect(markup).toContain("Copy");
  });

  it("is a button, not a submit", () => {
    // It lives inside forms on the settings panels; a submit here would save
    // the page instead of copying a line of text.
    expect(markup).toContain('type="button"');
  });

  /**
   * A sighted user sees the label change from "Copy" to "Copied". Without a
   * live region a screen reader user gets nothing at all - which is the same
   * complaint that prompted this, experienced by somebody with no way around
   * it.
   */
  it("announces its result to a screen reader", () => {
    expect(markup).toContain('aria-live="polite"');
  });

  it("carries an accessible name saying what it copies", () => {
    expect(
      renderToStaticMarkup(
        <CopyButton label="Copy the install snippet" text="hello" />,
      ),
    ).toContain('aria-label="Copy the install snippet"');
  });
});
