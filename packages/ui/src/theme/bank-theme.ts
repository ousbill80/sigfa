/**
 * Bank theming — SIGFA multi-tenant branding made effortless.
 *
 * A tenant bank brands the whole product by supplying ONE colour: its brand
 * hex. `deriveBankTheme` turns that single value into the five `--brand*`
 * tokens the design system consumes, keeping the SIGFA STRUCTURE and the fixed
 * neutral chassis + semantic palette (v3 « Neutre Premium ») untouched.
 *
 * The function is PURE and deterministic so it can run identically on the
 * server (SSR), in the client provider and in unit tests.
 *
 * Derivation:
 *  - `brandStrong`  : the brand darkened by ~15% lightness (hover / pressed),
 *                     then darkened further until it clears 7:1 on white — the
 *                     kiosk uses it as `--action-label` text on `--surface-1`
 *                     (audit borne 2026-07-14, F10 : seuil kiosque ≥ 7:1).
 *  - `brandSoft`    : the same hue at ~92% lightness (badge / highlight fills,
 *                     visually ~8-10% of brand over white).
 *  - `brandContrast`: black or white — whichever clears WCAG AA (≥ 4.5:1) as
 *                     text on `brand`, using the WCAG 2.1 relative-luminance
 *                     contrast formula (independently re-proven in tests via the
 *                     shared `lib/contrast` utility, which uses the same maths).
 *  - `brandInv`     : the brand lightened iteratively (same hue/saturation)
 *                     until it clears 7:1 on `--night` (#0a0a0a) — and thus on
 *                     the darker `--night-2` too. Used for the ticket number on
 *                     the dark kiosk/TV surfaces.
 *
 * This module is intentionally self-contained (no cross-module imports) so it
 * transpiles identically under Vite, Next/webpack and a future RN bundler.
 *
 * @module theme/bank-theme
 */

/** The SIGFA default brand (deep blue, v3 « Neutre Premium ») — used when a
 * tenant supplies none. White on #1d4ed8 is 6.70:1, honouring the DS claim of
 * ≥ 4.5:1 for `--brand-contrast`. Every bank replaces it. */
export const SIGFA_DEFAULT_BRAND = "#1d4ed8";

/** The five brand tokens a bank theme injects, as normalised hex strings. */
export interface BankTheme {
  /** Tenant primary (`--brand`), normalised to `#rrggbb` lowercase. */
  brand: string;
  /** Darkened primary for hover / pressed (`--brand-strong`). */
  brandStrong: string;
  /** Very light same-hue tint for soft fills (`--brand-soft`). */
  brandSoft: string;
  /** Black or white, WCAG-AA-safe as text on `brand` (`--brand-contrast`). */
  brandContrast: string;
  /** Lightened primary, ≥ 7:1 on `--night`/`--night-2` (`--brand-inv`). */
  brandInv: string;
}

const HEX_RE = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Hsl {
  h: number; // [0, 360)
  s: number; // [0, 1]
  l: number; // [0, 1]
}

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

/** Serialise 8-bit sRGB channels to a `#rrggbb` lowercase hex string. */
function toHex({ r, g, b }: Rgb): string {
  const clamp = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));
  const hex = (n: number): string => clamp(n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Convert sRGB (0–255) to HSL. */
function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
        break;
      case gn:
        h = ((bn - rn) / delta + 2) * 60;
        break;
      default:
        h = ((rn - gn) / delta + 4) * 60;
        break;
    }
  }
  return { h, s, l };
}

/** Convert HSL back to sRGB (0–255). */
function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = h / 360;
  return {
    r: hue2rgb(p, q, hn + 1 / 3) * 255,
    g: hue2rgb(p, q, hn) * 255,
    b: hue2rgb(p, q, hn - 1 / 3) * 255,
  };
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Quantize float channels to the 8-bit grid `toHex` will serialise to, so a
 * WCAG ratio proven inside a derivation loop still holds on the emitted hex
 * (unrounded floats can otherwise dip a hair below the threshold). */
function quantize({ r, g, b }: Rgb): Rgb {
  const q = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));
  return { r: q(r), g: q(g), b: q(b) };
}

/** Linearise a single 8-bit sRGB channel (WCAG 2.1 relative-luminance). */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance of an sRGB colour. */
function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** WCAG contrast ratio [1, 21] between two sRGB colours. */
function ratio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };
/** `--night` (#0a0a0a) — the LIGHTER of the two dark surfaces: clearing 7:1 on
 * it guarantees ≥ 7:1 on the darker `--night-2` (#050505) as well. */
const NIGHT: Rgb = { r: 10, g: 10, b: 10 };

/**
 * Derive the five `--brand*` tokens from a single tenant brand hex.
 *
 * Pure & deterministic. Throws on a malformed hex input.
 */
export function deriveBankTheme(brandHex: string): BankTheme {
  const rgb = parseHex(brandHex);
  const brand = toHex(rgb);
  const hsl = rgbToHsl(rgb);

  // Hover / pressed + kiosk `--action-label` text on `--surface-1`: same hue
  // & saturation, ~15% darker lightness — then keep darkening until the WCAG
  // ratio on white clears the kiosk threshold (≥ 7:1). Terminates: l = 0 is
  // black (21:1). Audit borne 2026-07-14 (F10).
  let strongL = clamp01(hsl.l - 0.15);
  let strongRgb = quantize(hslToRgb({ ...hsl, l: strongL }));
  while (ratio(WHITE, strongRgb) < 7 && strongL > 0) {
    strongL = clamp01(strongL - 0.02);
    strongRgb = quantize(hslToRgb({ ...hsl, l: strongL }));
  }
  const brandStrong = toHex(strongRgb);

  // Soft fill: same hue, gently desaturated, very light (~92% lightness) so it
  // reads as a tint and carries dark `--ink` text.
  const brandSoft = toHex(
    hslToRgb({ h: hsl.h, s: Math.min(hsl.s, 0.5), l: 0.92 }),
  );

  // Contrast: pick whichever of black/white clears AA (≥ 4.5:1) on brand.
  // On any given colour the better of the two is always ≥ 4.5:1 — proven across
  // the bank + edge-case suite (verified there via the shared lib/contrast).
  const brandContrast =
    ratio(WHITE, rgb) >= ratio(BLACK, rgb) ? "#ffffff" : "#000000";

  // Inverse (kiosk/TV ticket number on --night / --night-2): same hue &
  // saturation, lightened iteratively until the WCAG ratio on --night clears
  // 7:1 (which implies ≥ 7:1 on the darker --night-2). Terminates: l = 1 is
  // white (≈ 19:1 on night). An already-light brand is kept as-is.
  let invL = hsl.l;
  let invRgb = quantize(hslToRgb({ ...hsl, l: invL }));
  while (ratio(invRgb, NIGHT) < 7 && invL < 1) {
    invL = clamp01(invL + 0.02);
    invRgb = quantize(hslToRgb({ ...hsl, l: invL }));
  }
  const brandInv = toHex(invRgb);

  return { brand, brandStrong, brandSoft, brandContrast, brandInv };
}
