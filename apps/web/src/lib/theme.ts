/**
 * Theming utilities — CSS variable injection and contrast correction.
 * @module lib/theme
 */

/** Tenant theming profile */
export interface TenantTheme {
  /** Primary brand color (hex) */
  brand: string;
  /** Softer brand variant */
  brandSoft?: string;
  /** Contrast color on brand background */
  brandContrast?: string;
  /** Primary surface background */
  surface0?: string;
  /** Secondary surface background */
  surface1?: string;
  /** Strong ink (text) color */
  inkStrong?: string;
  /** Soft ink (secondary text) color */
  inkSoft?: string;
  /** Success state color */
  success?: string;
  /** Warning state color */
  warning?: string;
  /** Danger/error state color */
  danger?: string;
  /** Info state color */
  info?: string;
}

/** Default theme tokens */
export const DEFAULT_THEME: Required<TenantTheme> = {
  brand: "#1a56db",
  brandSoft: "#e8f0fe",
  brandContrast: "#ffffff",
  surface0: "#ffffff",
  surface1: "#f9fafb",
  inkStrong: "#111827",
  inkSoft: "#6b7280",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
};

/**
 * Parses a hex color to RGB components.
 * @param hex - Hex color string (#rrggbb or #rgb)
 * @returns RGB tuple or null if invalid
 */
export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0]!, 16);
    const g = parseInt(clean[1]! + clean[1]!, 16);
    const b = parseInt(clean[2]! + clean[2]!, 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

/**
 * Computes relative luminance per WCAG 2.1.
 * @param r - Red component (0-255)
 * @param g - Green component (0-255)
 * @param b - Blue component (0-255)
 * @returns Relative luminance (0–1)
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Computes WCAG contrast ratio between two colors.
 * @param hex1 - First hex color
 * @param hex2 - Second hex color
 * @returns Contrast ratio or 1 if colors are invalid
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return 1;
  const l1 = relativeLuminance(...rgb1);
  const l2 = relativeLuminance(...rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Darkens a hex color by the given factor (0–1).
 * @param hex - Hex color to darken
 * @param factor - Darkening factor (0 = no change, 1 = black)
 * @returns Darkened hex color
 */
export function darkenColor(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  const darken = (c: number): number => Math.max(0, Math.round(c * (1 - factor)));
  const toHex = (c: number): string => c.toString(16).padStart(2, "0");
  return `#${toHex(darken(r))}${toHex(darken(g))}${toHex(darken(b))}`;
}

/**
 * Auto-corrects brand color if contrast ratio vs white is below 4.5:1.
 * Darkens iteratively until ratio is met or max iterations reached.
 * @param brand - Brand hex color
 * @param background - Background hex color (default white)
 * @returns Corrected brand color that passes WCAG AA
 */
export function autoCorrectedBrand(brand: string, background = "#ffffff"): string {
  const MIN_RATIO = 4.5;
  let current = brand;
  let iterations = 0;
  const MAX_ITER = 20;

  while (contrastRatio(current, background) < MIN_RATIO && iterations < MAX_ITER) {
    current = darkenColor(current, 0.1);
    iterations++;
  }
  return current;
}

/**
 * Generates CSS custom property string from a TenantTheme.
 * Auto-corrects brand color if contrast is insufficient.
 * @param theme - The tenant theme config
 * @returns CSS variables string for injection into :root
 */
export function generateCSSVars(theme: TenantTheme): string {
  const merged = { ...DEFAULT_THEME, ...theme };
  const correctedBrand = autoCorrectedBrand(merged.brand);

  return [
    `--brand: ${correctedBrand}`,
    `--brand-soft: ${merged.brandSoft}`,
    `--brand-contrast: ${merged.brandContrast}`,
    `--surface-0: ${merged.surface0}`,
    `--surface-1: ${merged.surface1}`,
    `--ink-strong: ${merged.inkStrong}`,
    `--ink-soft: ${merged.inkSoft}`,
    `--success: ${merged.success}`,
    `--warning: ${merged.warning}`,
    `--danger: ${merged.danger}`,
    `--info: ${merged.info}`,
  ].join("; ");
}
