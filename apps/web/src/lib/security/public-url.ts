import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { CookieJar } from "tough-cookie";
import { AppError } from "@/lib/http/errors";

function isPrivateIp(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  ) {
    return true;
  }
  if (isIP(normalized) !== 4) return false;
  const [a, b] = normalized.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export async function validatePublicUrl(
  value: string,
  { allowPrivate = false }: { allowPrivate?: boolean } = {},
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("INVALID_URL", "Enter a valid URL.", 422);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AppError(
      "UNSUPPORTED_PROTOCOL",
      "Only HTTP and HTTPS URLs are supported.",
      422,
    );
  }
  if (url.username || url.password) {
    throw new AppError(
      "URL_CREDENTIALS_BLOCKED",
      "URLs with embedded credentials are not allowed.",
      422,
    );
  }
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    !records.length ||
    (!allowPrivate &&
      records.some((record) => isPrivateIp(record.address)))
  ) {
    throw new AppError(
      "PRIVATE_URL_BLOCKED",
      "Private and local network URLs are not allowed.",
      422,
    );
  }
  url.hash = "";
  return url;
}

type SafeFetchInit = RequestInit & {
  timeoutMs?: number;
  maxBytes?: number;
  allowPrivate?: boolean;
};

export type SafeFetcher = (
  input: string | URL,
  init?: SafeFetchInit,
) => Promise<{ response: Response; finalUrl: URL }>;

async function fetchWithRedirects(
  input: string | URL,
  init: SafeFetchInit,
  cookieJar: CookieJar,
  redirectCount = 0,
): Promise<{ response: Response; finalUrl: URL }> {
  if (redirectCount > 5) {
    throw new AppError("TOO_MANY_REDIRECTS", "Too many redirects.", 422);
  }
  const {
    timeoutMs = 15_000,
    maxBytes = 3_000_000,
    allowPrivate = false,
    headers: customHeaders,
    ...fetchInit
  } = init;
  const url = await validatePublicUrl(String(input), { allowPrivate });
  const headers = new Headers({
    "user-agent": "DocentBot/0.2 (+self-hosted knowledge crawler)",
    accept:
      "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.1",
  });
  new Headers(customHeaders).forEach((value, key) => {
    headers.set(key, value);
  });
  const cookieHeader = await cookieJar.getCookieString(url.href);
  if (cookieHeader) {
    const existingCookieHeader = headers.get("cookie");
    headers.set(
      "cookie",
      existingCookieHeader
        ? `${existingCookieHeader}; ${cookieHeader}`
        : cookieHeader,
    );
  }
  const response = await fetch(url, {
    ...fetchInit,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers,
  });
  for (const setCookie of response.headers.getSetCookie()) {
    await cookieJar.setCookie(setCookie, url.href, { ignoreError: true });
  }
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.has("location")
  ) {
    return fetchWithRedirects(
      new URL(response.headers.get("location")!, url),
      init,
      cookieJar,
      redirectCount + 1,
    );
  }
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maxBytes) {
    throw new AppError(
      "REMOTE_CONTENT_TOO_LARGE",
      `The remote page exceeds the ${Math.round(maxBytes / 1_000_000)} MB limit.`,
      413,
    );
  }
  if (!response.body) return { response, finalUrl: url };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new AppError(
        "REMOTE_CONTENT_TOO_LARGE",
        `The remote page exceeds the ${Math.round(maxBytes / 1_000_000)} MB limit.`,
        413,
      );
    }
    chunks.push(value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    response: new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    finalUrl: url,
  };
}

export async function safeFetch(
  input: string | URL,
  init: SafeFetchInit = {},
): Promise<{ response: Response; finalUrl: URL }> {
  return fetchWithRedirects(input, init, new CookieJar());
}

export function createSafeFetcher({
  allowPrivate = false,
}: { allowPrivate?: boolean } = {}): SafeFetcher {
  const cookieJar = new CookieJar();
  return (input, init = {}) =>
    fetchWithRedirects(
      input,
      { ...init, allowPrivate },
      cookieJar,
    );
}
