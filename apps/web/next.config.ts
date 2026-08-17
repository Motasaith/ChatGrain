import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*"],
  },
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "playwright-core",
    "pino",
    // Document parsers are loaded on demand at runtime; bundling them pulls
    // large binaries into the server build for uploads most agents never use.
    "unpdf",
    "exceljs",
  ],
};

/**
 * Sentry's plugin exists to upload source maps, which only matters for a build
 * real users hit. Running it under `next dev` costs memory and compile time for
 * an artefact nobody uploads, and on a small machine that cost is the
 * difference between the dev server starting and the compiler being killed by
 * the OS. Set `SENTRY_IN_DEV=1` if you ever need to debug the plugin itself.
 *
 * Keyed on the phase Next passes in rather than on NODE_ENV: the phase is the
 * documented signal, and it stays correct for the other commands that also run
 * with NODE_ENV unset or set to something unexpected.
 */
const config = (phase: string): NextConfig => {
  const skipSentry =
    phase === PHASE_DEVELOPMENT_SERVER && process.env.SENTRY_IN_DEV !== "1";
  if (skipSentry) return nextConfig;
  return withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG ?? "bina-codes",
    project: process.env.SENTRY_PROJECT ?? "javascript-nextjs",
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: !process.env.CI,
    widenClientFileUpload: true,
  }) as NextConfig;
};

export default config;
