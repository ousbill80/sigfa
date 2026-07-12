/**
 * SIGFA Design System v2 — « Sérénité Premium » — token values (JS/TS).
 *
 * This module is the JavaScript-side source of the design tokens. It mirrors
 * `tokens.css` exactly and exists so the values can be consumed where CSS
 * custom properties are not available: unit tests (WCAG contrast proofs),
 * and a future React Native (mobile) theme.
 *
 * RULE: raw hex literals live ONLY in the token layer (`tokens.css` +
 * this file). Components must reference CSS variables (`var(--brand)`), never
 * hard-coded colours.
 *
 * @module tokens
 */

/** Warm ink & surface ramp (light). Never clinical grey. */
export const surfaces = {
  paper: "#FBF8F3",
  surface1: "#FFFFFF",
  surface2: "#F4EEE4",
  ink: "#1A130C",
  inkSoft: "#6B5D4F",
  inkFaint: "#A99C8B",
  hairline: "#ECE3D6",
  night: "#16110B",
  night2: "#0E0A06",
  inkInverse: "#FBF6EE",
  inkInverseSoft: "#B8AB98",
} as const;

/** SIGFA brand — « Or & Forêt » (premium Ivorian identity). */
export const brand = {
  brand: "#C25A16",
  brandStrong: "#9C400C",
  brandSoft: "#F7E7D6",
  brandContrast: "#FFFFFF",
  forest: "#0F6B4A",
  forestSoft: "#DBEFE6",
  gold: "#C79A3A",
  goldSoft: "#F6ECD2",
} as const;

/** Functional semantics, harmonised to the warm palette. */
export const semantic = {
  success: "#0F7A4D",
  successSoft: "#DBEFE6",
  warning: "#C77D0A",
  warningSoft: "#F9EBD1",
  danger: "#C0362C",
  dangerSoft: "#F7DED9",
  info: "#2C6E9B",
  infoSoft: "#DCEAF3",
} as const;

/** All colour tokens, flattened, keyed by CSS custom-property name. */
export const color = {
  "--paper": surfaces.paper,
  "--surface-1": surfaces.surface1,
  "--surface-2": surfaces.surface2,
  "--ink": surfaces.ink,
  "--ink-soft": surfaces.inkSoft,
  "--ink-faint": surfaces.inkFaint,
  "--hairline": surfaces.hairline,
  "--night": surfaces.night,
  "--night-2": surfaces.night2,
  "--ink-inverse": surfaces.inkInverse,
  "--ink-inverse-soft": surfaces.inkInverseSoft,
  "--brand": brand.brand,
  "--brand-strong": brand.brandStrong,
  "--brand-soft": brand.brandSoft,
  "--brand-contrast": brand.brandContrast,
  "--forest": brand.forest,
  "--forest-soft": brand.forestSoft,
  "--gold": brand.gold,
  "--gold-soft": brand.goldSoft,
  "--success": semantic.success,
  "--success-soft": semantic.successSoft,
  "--warning": semantic.warning,
  "--warning-soft": semantic.warningSoft,
  "--danger": semantic.danger,
  "--danger-soft": semantic.dangerSoft,
  "--info": semantic.info,
  "--info-soft": semantic.infoSoft,
} as const;

/**
 * Modular type scale (ratio 1.25, base 16). Values in px.
 * `display` is the kiosk ticket number.
 */
export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 25,
  "2xl": 31,
  "3xl": 39,
  "4xl": 49,
  display: 76,
} as const;

/** Radii (px). Assumed, coherent — the end of "neither round nor square". */
export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 28,
  full: 999,
} as const;

/** Warm, soft, layered elevation. Tinted brown, never pure black. */
export const shadow = {
  "1": "0 1px 2px rgba(26,19,12,.06), 0 1px 3px rgba(26,19,12,.05)",
  "2": "0 4px 12px rgba(26,19,12,.08), 0 2px 4px rgba(26,19,12,.05)",
  "3": "0 12px 32px rgba(26,19,12,.12), 0 4px 8px rgba(26,19,12,.06)",
  brand: "0 8px 24px rgba(194,90,22,.28)",
  gold: "0 0 48px rgba(199,154,58,.35)",
} as const;

/** Spacing scale (base 4, generous). Values in px. */
export const space = {
  "0": 0,
  "1": 4,
  "2": 8,
  "3": 12,
  "4": 16,
  "6": 24,
  "8": 32,
  "12": 48,
  "16": 64,
  "24": 96,
} as const;

/** Motion — just, never gratuitous. */
export const motion = {
  ease: "cubic-bezier(.2,.7,.2,1)",
  dur1: "120ms",
  dur2: "220ms",
  dur3: "360ms",
} as const;

/** Font stacks. Swappable via the `--font-display` / `--font-text` tokens. */
export const font = {
  display:
    '"Clash Display", "General Sans", ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  text: '"General Sans", "Inter Tight", ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
} as const;

/** The complete token bundle (useful for a mobile RN theme). */
export const tokens = {
  color,
  fontSize,
  radius,
  shadow,
  space,
  motion,
  font,
} as const;

export type Tokens = typeof tokens;
