/**
 * SIGFA Design System v3 — « Neutre Premium » — token values (JS/TS).
 *
 * This module is the JavaScript-side source of the design tokens. It mirrors
 * `tokens.css` exactly (the `color-mix()` fallbacks are mirrored as their
 * resolved default-brand values) and exists so the values can be consumed
 * where CSS custom properties are not available: unit tests (WCAG contrast
 * proofs), and a future React Native (mobile) theme.
 *
 * RULE: raw hex literals live ONLY in the token layer (`tokens.css` +
 * this file). Components must reference CSS variables (`var(--brand)`), never
 * hard-coded colours.
 *
 * @module tokens
 */

/** Pure neutral ink & surface ramp (light + dark). No warm/beige tint. */
export const surfaces = {
  paper: "#FAFAFA",
  surface1: "#FFFFFF",
  surface2: "#F5F5F5",
  ink: "#0A0A0A",
  inkSoft: "#525252",
  inkFaint: "#A3A3A3",
  hairline: "#E5E5E5",
  night: "#0A0A0A",
  night2: "#050505",
  inkInverse: "#FAFAFA",
  inkInverseSoft: "#A3A3A3",
} as const;

/** Brand — the ONLY chromatic accent, tenant-overridable.
 *
 * Defaults below are the resolved values of the `color-mix()` fallbacks in
 * `tokens.css` for the default brand #1D4ED8 (deep blue — product fallback,
 * every bank replaces it). Measured ratios: white on brand 6.70:1 (>= 4.5),
 * brandStrong on white 10.38:1 (>= 7), brandInv 8.38:1 on night / 8.63:1 on
 * night-2 (>= 7). `deriveBankTheme()` recomputes them WCAG-safe per tenant. */
export const brand = {
  brand: "#1D4ED8",
  brandStrong: "#143797",
  brandSoft: "#E8EDFB",
  brandContrast: "#FFFFFF",
  brandInv: "#8EA7EC",
  /* DEPRECATED v3 — à supprimer après migration des surfaces. Alias of the
     v3 equivalents (`--forest` -> success, `--gold` -> brand-inv). */
  forest: "#15803D",
  forestSoft: "#DCFCE7",
  gold: "#8EA7EC",
  goldSoft: "#E8EDFB",
} as const;

/** Functional semantics — sober, standard hues on the neutral chassis. */
export const semantic = {
  success: "#15803D",
  successSoft: "#DCFCE7",
  warning: "#B45309",
  warningSoft: "#FEF3C7",
  danger: "#DC2626",
  dangerSoft: "#FFF5F5",
  info: "#0369A1",
  infoSoft: "#E0F2FE",
  /* Inverses pour fond sombre (--night/--night-2). Ratios mesures sur
     --night / --night-2 : 11.36/11.70, 11.86/12.21, 10.43/10.74, 9.24/9.51
     (:1) — seuil kiosque/TV >= 7:1. */
  successInv: "#4ADE80",
  warningInv: "#FBBF24",
  dangerInv: "#FCA5A5",
  infoInv: "#38BDF8",
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
  "--brand-inv": brand.brandInv,
  /* DEPRECATED v3 — à supprimer après migration des surfaces. */
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
  "--success-inv": semantic.successInv,
  "--warning-inv": semantic.warningInv,
  "--danger-inv": semantic.dangerInv,
  "--info-inv": semantic.infoInv,
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

/** Neutral, subtle elevation — pure black at low alpha, never tinted.
 * `brand` mirrors the resolved `color-mix(brand 22%, transparent)` and
 * `gold` (DEPRECATED v3 — à supprimer après migration des surfaces) the
 * resolved brand-inv halo, both for the default brand #1D4ED8. */
export const shadow = {
  "1": "0 1px 2px rgba(0,0,0,.05), 0 1px 3px rgba(0,0,0,.04)",
  "2": "0 4px 12px rgba(0,0,0,.07), 0 2px 4px rgba(0,0,0,.04)",
  "3": "0 12px 32px rgba(0,0,0,.10), 0 4px 8px rgba(0,0,0,.05)",
  brand: "0 8px 24px rgba(29,78,216,.22)",
  gold: "0 0 48px rgba(142,167,236,.30)",
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
  mono: 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
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
