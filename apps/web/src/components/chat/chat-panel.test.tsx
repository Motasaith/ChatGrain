import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatPanel } from "./chat-panel";

const requiredProps = {
  agentId: "00000000-0000-0000-0000-000000000001",
  name: "Support",
  primaryColor: "#177e51",
  welcomeMessage: "How can I help?",
};

describe("widget branding", () => {
  it("shows ChatGrain attribution by default", () => {
    expect(
      renderToStaticMarkup(<ChatPanel {...requiredProps} />),
    ).toContain("Powered by");
  });

  it("links the attribution to the product site", () => {
    expect(renderToStaticMarkup(<ChatPanel {...requiredProps} />)).toContain(
      'href="https://chatgrain.com"',
    );
  });

  /**
   * The widget renders inside an iframe on somebody else's website. A same-tab
   * navigation would replace the chat panel with our homepage while leaving the
   * customer's page around it untouched, which reads as the widget breaking
   * rather than as a link being followed - and it takes away a conversation the
   * visitor was in the middle of.
   */
  it("opens the attribution in a new tab", () => {
    expect(renderToStaticMarkup(<ChatPanel {...requiredProps} />)).toContain(
      'target="_blank"',
    );
  });

  /**
   * `noopener` because a page opened with `target="_blank"` can otherwise reach
   * back through `window.opener` and navigate the page that opened it - which
   * here is a customer's own website. `noreferrer` because that site should not
   * be told which of their visitors clicked.
   */
  it("does not hand the opened page a handle on the customer's site", () => {
    const markup = renderToStaticMarkup(<ChatPanel {...requiredProps} />);
    expect(markup).toContain("noopener");
    expect(markup).toContain("noreferrer");
  });

  it("removes ChatGrain attribution when an administrator disables it", () => {
    expect(
      renderToStaticMarkup(
        <ChatPanel {...requiredProps} showBranding={false} />,
      ),
    ).not.toContain("Powered by");
  });
});

describe("widget help center", () => {
  it("shows the help center control by default", () => {
    expect(
      renderToStaticMarkup(<ChatPanel {...requiredProps} />),
    ).toContain('aria-label="Help center"');
  });

  it("can be disabled per agent", () => {
    expect(
      renderToStaticMarkup(
        <ChatPanel {...requiredProps} helpCenterEnabled={false} />,
      ),
    ).not.toContain('aria-label="Help center"');
  });
});
