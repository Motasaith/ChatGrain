import { afterEach, describe, expect, it, vi } from "vitest";

import { voiceSocketUrl } from "./call";

function pageAt(href: string) {
  const url = new URL(href);
  vi.stubGlobal("window", {
    location: { protocol: url.protocol, host: url.host, hostname: url.hostname },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("voiceSocketUrl", () => {
  it("reaches the gateway directly over plain HTTP", () => {
    // Local development: the gateway listens on its own port.
    pageAt("http://localhost:3000/");
    expect(voiceSocketUrl()).toBe("ws://localhost:3002/voice");
  });

  it("shares the page origin under TLS", () => {
    // A non-standard port over wss:// would need its own certificate, so a
    // proxied deployment must reach the gateway through the same origin.
    pageAt("https://chatgrain.com/");
    expect(voiceSocketUrl()).toBe("wss://chatgrain.com/voice");
  });

  it("keeps a non-default port when the page carries one", () => {
    pageAt("https://chatgrain.com:8443/");
    expect(voiceSocketUrl()).toBe("wss://chatgrain.com:8443/voice");
  });

  it("never mixes an insecure socket into a secure page", () => {
    pageAt("https://chatgrain.com/");
    expect(voiceSocketUrl().startsWith("wss://")).toBe(true);
  });
});
