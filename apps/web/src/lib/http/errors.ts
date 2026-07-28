import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/lib/observability/logger";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: unknown, requestId?: string) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "The request contains invalid fields.",
          fields: error.flatten().fieldErrors,
          requestId,
        },
      },
      { status: 422 },
    );
  }

  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        },
      },
      { status: error.status },
    );
  }

  logger.error({ error, requestId }, "Unhandled request error");
  Sentry.captureException(error, {
    tags: { requestId: requestId ?? "unknown" },
  });
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId,
      },
    },
    { status: 500 },
  );
}

export async function readJson(request: Request, maxBytes = 1_000_000) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      "The request body is too large.",
      413,
    );
  }
  try {
    if (!request.body) throw new Error("Missing body");
    const reader = request.body.getReader();
    const parts: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new AppError(
          "PAYLOAD_TOO_LARGE",
          "The request body is too large.",
          413,
        );
      }
      parts.push(value);
    }
    const body = new Uint8Array(received);
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INVALID_JSON",
      "The request body must be valid JSON.",
      400,
    );
  }
}
