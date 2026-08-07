import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import("./lib/observability/worker-sentry")
  .then(async ({ initializeWorkerSentry }) => {
    initializeWorkerSentry();
    const { startVoiceGateway, voiceEnabled } = await import(
      "./lib/voice/gateway"
    );
    if (!voiceEnabled()) {
      console.log("ChatGrain voice gateway is disabled (VOICE_ENABLED=false)");
      return;
    }
    const stop = startVoiceGateway();
    const shutdown = () => {
      void stop().finally(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((error) => {
    console.error("Failed to start the ChatGrain voice gateway", error);
    process.exitCode = 1;
  });
