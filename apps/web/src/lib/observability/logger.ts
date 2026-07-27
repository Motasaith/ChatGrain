import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    service: "docent-web",
    environment: process.env.NODE_ENV ?? "development",
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "headers.authorization",
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
    ],
    censor: "[REDACTED]",
  },
});
