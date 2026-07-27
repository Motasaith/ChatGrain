import "server-only";

import { jwtVerify, SignJWT } from "jose";
import { AppError } from "@/lib/http/errors";

function signingKey() {
  const secret =
    process.env.WIDGET_SIGNING_SECRET ??
    (process.env.NODE_ENV === "development"
      ? "docent-development-widget-secret-change-before-deploying"
      : "");
  if (secret.length < 32) {
    throw new AppError(
      "WIDGET_SECRET_MISSING",
      "Set WIDGET_SIGNING_SECRET to at least 32 random characters.",
      503,
    );
  }
  return new TextEncoder().encode(secret);
}

export function normalizeHost(value: string) {
  const input = value.trim().toLowerCase();
  if (!input) return "";
  try {
    return new URL(input.includes("://") ? input : `https://${input}`).hostname;
  } catch {
    return input.replace(/^\*\./, "");
  }
}

export function domainAllowed(host: string, allowedDomains: string[]) {
  const normalizedHost = normalizeHost(host);
  return allowedDomains.some((entry) => {
    const normalizedEntry = normalizeHost(entry);
    return (
      normalizedHost === normalizedEntry ||
      (entry.trim().startsWith("*.") &&
        normalizedHost.endsWith(`.${normalizedEntry}`))
    );
  });
}

export async function createWidgetToken(agentId: string, host: string) {
  return new SignJWT({ agentId, host: normalizeHost(host) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("docent-widget")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(signingKey());
}

export async function verifyWidgetToken(token: string, agentId: string) {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: "docent-widget",
      algorithms: ["HS256"],
    });
    if (payload.agentId !== agentId || typeof payload.host !== "string") {
      throw new Error("Token does not match the agent.");
    }
    return { host: payload.host };
  } catch {
    throw new AppError(
      "INVALID_WIDGET_TOKEN",
      "This widget session is invalid or expired.",
      403,
    );
  }
}
