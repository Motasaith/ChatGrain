import { AppError } from "./errors";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit = 30,
  windowMs = 60_000,
) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many requests. Please wait a moment and try again.",
      429,
      { retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1_000) },
    );
  }
  if (buckets.size > 10_000) {
    for (const [itemKey, item] of buckets) {
      if (item.resetAt <= now) buckets.delete(itemKey);
    }
  }
}
