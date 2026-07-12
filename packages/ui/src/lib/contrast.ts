/**
 * WCAG 2.1 contrast utilities (deterministic).
 *
 * Used to PROVE, in tests, that the SIGFA v2 token pairs meet the required
 * ratios: ≥ 4.5:1 for normal text, ≥ 3:1 for large text (AA), ≥ 7:1 for the
 * kiosk / call-screen (AAA). Colour input is any CSS hex (`#rgb`, `#rrggbb`,
 * with or without the leading `#`).
 *
 * @module lib/contrast
 */

/** WCAG conformance level. */
export type WcagLevel = "AA" | "AAA";

/** Text size class — governs which threshold applies. */
export type TextSize = "normal" | "large";

export interface WcagOptions {
  /** Conformance level. Defaults to "AA". */
  level?: WcagLevel;
  /** Text size class. Defaults to "normal". */
  size?: TextSize;
}

/** Parsed sRGB channel triple, each in [0, 255]. */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_RE = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Parse a CSS hex colour into 8-bit sRGB channels. Throws if malformed. */
function parseHex(input: string): Rgb {
  const value = input.trim();
  if (!HEX_RE.test(value)) {
    throw new Error(`Invalid hex colour: "${input}"`);
  }
  let hex = value.startsWith("#") ? value.slice(1) : value;
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

/** Linearise a single 8-bit sRGB channel (WCAG relative-luminance formula). */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Relative luminance of a colour, per WCAG 2.1. */
function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/**
 * Contrast ratio between two colours, in the range [1, 21].
 * Symmetric: `contrastRatio(a, b) === contrastRatio(b, a)`.
 */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = luminance(parseHex(foreground));
  const l2 = luminance(parseHex(background));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Minimum ratio required for a given level + size. */
export function requiredRatio(level: WcagLevel, size: TextSize): number {
  if (level === "AAA") {
    return size === "large" ? 4.5 : 7;
  }
  return size === "large" ? 3 : 4.5;
}

/**
 * Whether a foreground/background pair meets the required WCAG ratio.
 * Defaults to AA / normal text.
 */
export function meetsWcag(
  foreground: string,
  background: string,
  options: WcagOptions = {},
): boolean {
  const level = options.level ?? "AA";
  const size = options.size ?? "normal";
  return contrastRatio(foreground, background) >= requiredRatio(level, size);
}
