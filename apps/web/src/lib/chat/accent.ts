/**
 * Accent colours that stay legible on the widget's light surfaces.
 *
 * The agent's primary colour is chosen to sit behind white text in the header,
 * so nothing stops it being near-white. Used unmodified as a text or caret
 * colour it then disappears: a real agent here is configured #fafafa, which
 * rendered the follow-up chips and the input caret invisible.
 */

function channels(hex: string) {
  const value = hex.trim().replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((part) => part + part)
          .join("")
      : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ] as const;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string) {
  const rgb = channels(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function readableTextColor(hex: string) {
  return relativeLuminance(hex) > 0.55 ? "#0f1f16" : "#ffffff";
}

/**
 * A version of the accent dark enough to read on a white panel.
 *
 * Scales the channels down rather than substituting a fixed colour, so a
 * merely light brand keeps its hue and only a colour with no usable darkness
 * left collapses to near-black.
 */
export function readableAccent(hex: string) {
  const rgb = channels(hex);
  if (!rgb) return "#0f1f16";
  let [r, g, b] = rgb;
  // 0.32 keeps roughly 4.5:1 against white for typical hues.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `#${[r, g, b]
      .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
      .join("")}`;
    if (relativeLuminance(candidate) <= 0.32) return candidate;
    r *= 0.8;
    g *= 0.8;
    b *= 0.8;
  }
  return "#0f1f16";
}
