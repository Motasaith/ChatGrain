import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import("./lib/observability/worker-sentry")
  .then(({ initializeWorkerSentry }) => {
    initializeWorkerSentry();
    return import("./worker");
  })
  .catch((error) => {
    console.error("Failed to start the ChatGrain worker", error);
    process.exitCode = 1;
  });
