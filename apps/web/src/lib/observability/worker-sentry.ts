import * as Sentry from "@sentry/node";

let initialized = false;

export function initializeWorkerSentry() {
  if (initialized || !process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    enableLogs: true,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
  Sentry.setTag("service", "docent-worker");
  initialized = true;
}

export function captureWorkerException(
  error: unknown,
  context?: Record<string, unknown>,
) {
  if (!initialized) return;
  Sentry.captureException(error, {
    extra: context,
    tags: { service: "docent-worker" },
  });
}

