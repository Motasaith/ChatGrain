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
    // Document parsers are loaded on demand at runtime; bundling them pulls
    // large binaries into the server build for uploads most agents never use.
    "unpdf",
    "exceljs",
  ],
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "bina-codes",
  project: process.env.SENTRY_PROJECT ?? "javascript-nextjs",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
