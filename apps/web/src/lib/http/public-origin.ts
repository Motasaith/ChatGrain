/**
 * The public origin of this installation, normalised.
 *
 * `origin` rather than the raw setting, because everything that uses it appends
 * a path. `NEXT_PUBLIC_APP_URL=https://example.com/` is a perfectly reasonable
 * thing to write in a .env file, and concatenating it produced
 * `https://example.com//embed.js` - in a script tag and a curl command printed
 * on the developer page for people to copy and run.
 */
export function publicOrigin(
  // Only the three keys it reads, so a test can pass those three rather than a
  // whole synthetic environment.
  env: Readonly<Record<string, string | undefined>> = process.env,
  fallback = "http://localhost:3000",
) {
  for (const value of [
    env.DOCENT_PUBLIC_URL,
    env.APP_URL,
    env.NEXT_PUBLIC_APP_URL,
  ]) {
    if (!value) continue;
    try {
      const url = new URL(value.trim());
      if (["http:", "https:"].includes(url.protocol)) return url.origin;
    } catch {
      // Keep looking; a malformed setting is not a reason to give up on the
      // ones after it.
    }
  }
  return fallback;
}
