/**
 * Accepts what people actually type into a "website" field.
 *
 * "example.com" is what everyone means by a website address; requiring the
 * scheme is a technicality that only the form cared about.
 */

/** A scheme is only real when followed by "//" - see the localhost note. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function normalizeUrlInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  // Requiring "//" rather than just a colon keeps "localhost:3000" a host with
  // a port instead of a scheme called "localhost". It also means a hostile
  // "javascript:alert(1)" is not recognised as a scheme, so it gets the https
  // prefix and then fails URL parsing, rather than being passed through.
  if (HAS_SCHEME.test(trimmed)) return trimmed;

  // Protocol-relative input already carries an authority.
  if (trimmed.startsWith("//")) return `https:${trimmed}`;

  return `https://${trimmed}`;
}
