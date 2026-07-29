import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*"],
  },
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "playwright-core",
    "pino",
  ],
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "bina-codes",
  project: process.env.SENTRY_PROJECT ?? "javascript-nextjs",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
