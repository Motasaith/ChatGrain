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
  it("shows Docent attribution by default", () => {
    expect(
      renderToStaticMarkup(<ChatPanel {...requiredProps} />),
    ).toContain("Powered by");
  });

  it("removes Docent attribution when an administrator disables it", () => {
    expect(
      renderToStaticMarkup(
        <ChatPanel {...requiredProps} showBranding={false} />,
      ),
    ).not.toContain("Powered by");
  });
});
