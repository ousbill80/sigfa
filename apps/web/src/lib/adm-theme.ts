/**
 * adm-theme.ts — theming console preview logic (ADM-001b).
 *
 * The live preview is an EXACT MIRROR of the server-authoritative computation
 * (ADM-001a): it derives the four `--brand*` tokens via the SHARED `@sigfa/ui`
 * `deriveBankTheme` utility and measures WCAG contrast via `@sigfa/ui`'s
 * `contrastRatio`. It NEVER re-implements a divergent contrast/derivation maths
 * — the server is the source of truth, this is only its preview reflection.
 *
 * It also maps the console's single `--brand` model onto the contract's
 * `ColorSet` (primary/secondary/background) so PATCH /banks/{id}/theme stays
 * on-contract, and translates the theme error codes (INVALID_BRAND /
 * UNKNOWN_FIELD / INVALID_LOGO) to human namespaced messages.
 *
 * @module lib/adm-theme
 */
import { contrastRatio, deriveBankTheme, type BankTheme } from "@sigfa/ui";
import { tAdmTheme, type AdmThemeKey } from "./adm-theme-i18n";
import type { Locale } from "./i18n";
import type { Role } from "./roles";

/**
 * Roles allowed to configure the bank identity / theming (ADM-001b RBAC).
 * Theming = habillage, BANK_ADMIN+ incl. AGENCY_DIRECTOR. AGENT / MANAGER /
 * AUDITOR are denied (→ 403 on the section).
 */
const THEMING_ROLES: readonly Role[] = ["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR"];

/**
 * Whether a role may configure the bank theming (identity section).
 * @param role - The viewer role.
 * @returns true for SUPER_ADMIN / BANK_ADMIN / AGENCY_DIRECTOR.
 */
export function canConfigureTheming(role: Role): boolean {
  return THEMING_ROLES.includes(role);
}

/** WCAG AA minimum for normal text (≥ 4.5:1) — same threshold as the server. */
export const MIN_CONTRAST = 4.5;

/**
 * The light surface the brand colour is read against (`--surface-0`, white).
 * A light brand fails AA on this surface and the server darkens it until it
 * clears — the console preview mirrors that check.
 */
export const SURFACE = "#ffffff";

/** Strict `#RRGGBB` hex accepted by the contract (`ColorSet.primary` pattern). */
export const BRAND_HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** Welcome messages (FR required, EN optional) — mirrors `WelcomeMessages`. */
export interface WelcomeMessages {
  fr: string;
  en?: string;
}

/** The console's editable theme model: ONE brand colour + messages + logo. */
export interface ThemeDraft {
  /** Tenant primary (`--brand`) as requested by the BANK_ADMIN. */
  brand: string;
  /** Welcome messages (FR required). */
  welcomeMessages: WelcomeMessages;
  /** Current logo URL (null when none — placeholder shown). */
  logoUrl: string | null;
}

/** The live preview of a brand colour — mirrors the server derivation. */
export interface BrandPreview {
  /** True when the input is a syntactically valid `#RRGGBB` colour. */
  valid: boolean;
  /** The four derived tokens for the APPLIED colour (only when `valid`). */
  tokens: BankTheme | null;
  /** Contrast ratio of the REQUESTED brand against the light surface. */
  ratio: number;
  /** Whether the requested colour clears AA (≥ 4.5:1) on the surface. */
  passes: boolean;
  /** The colour actually applied — corrected (darkened) when it fails. */
  appliedBrand: string;
  /** Whether the applied colour differs from the requested one. */
  corrected: boolean;
}

/**
 * Darken a valid `#RRGGBB` colour toward black by `factor` (0–1).
 * @param hex - Source colour (`#RRGGBB`).
 * @param factor - Fraction to remove from each channel.
 * @returns The darkened `#RRGGBB` colour.
 */
function darken(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const d = (c: number): string =>
    Math.max(0, Math.round(c * (1 - factor)))
      .toString(16)
      .padStart(2, "0");
  return `#${d(r)}${d(g)}${d(b)}`;
}

/**
 * Compute the server-mirror preview for a requested brand colour.
 *
 * Derivation + contrast use the SHARED `@sigfa/ui` utilities so this reflects
 * exactly what ADM-001a persists. A light brand that cannot be read on the
 * light surface (< 4.5:1) is darkened by deterministic 10% steps until it
 * clears — the same correction the server applies — and the derived tokens are
 * recomputed for the corrected colour.
 *
 * @param brand - The requested brand colour (any string; may be invalid).
 * @returns A {@link BrandPreview}.
 */
export function previewBrand(brand: string): BrandPreview {
  const trimmed = brand.trim();
  if (!BRAND_HEX_RE.test(trimmed)) {
    return { valid: false, tokens: null, ratio: 0, passes: false, appliedBrand: trimmed, corrected: false };
  }
  const requested = deriveBankTheme(trimmed).brand;
  const ratio = contrastRatio(requested, SURFACE);
  const passes = ratio >= MIN_CONTRAST;

  if (passes) {
    const tokens = deriveBankTheme(requested);
    return { valid: true, tokens, ratio, passes: true, appliedBrand: requested, corrected: false };
  }

  // Mirror the server: darken by deterministic 10% steps until AA holds on the
  // surface, then derive the tokens from the corrected colour.
  let current = requested;
  for (let i = 0; i < 20; i += 1) {
    current = darken(current, 0.1);
    if (contrastRatio(current, SURFACE) >= MIN_CONTRAST) {
      return { valid: true, tokens: deriveBankTheme(current), ratio, passes: false, appliedBrand: current, corrected: true };
    }
  }
  // Black always clears AA; the loop terminates well before this.
  return { valid: true, tokens: deriveBankTheme("#000000"), ratio, passes: false, appliedBrand: "#000000", corrected: true };
}

/**
 * Build an on-contract `requestedColors` ColorSet from the single brand token.
 * The console only offers `--brand`; `secondary` derives from the brand-strong
 * token and `background` is fixed white (structure is never tenant-owned).
 * @param brand - A valid `#RRGGBB` brand colour.
 * @returns The `ColorSet` payload for PATCH /banks/{id}/theme.
 */
export function toRequestedColors(brand: string): { primary: string; secondary: string; background: string } {
  const tokens = deriveBankTheme(brand);
  return { primary: tokens.brand, secondary: tokens.brandStrong, background: "#ffffff" };
}

/** Contract error envelope (subset). */
interface ThemeErrorEnvelope {
  error?: { code?: string };
}

/** Theme error code → namespaced `admTheme.*` message key. */
const THEME_ERROR_KEYS: Record<string, AdmThemeKey> = {
  INVALID_BRAND: "admTheme.error_invalid_brand",
  UNKNOWN_FIELD: "admTheme.error_unknown_field",
  INVALID_LOGO: "admTheme.error_invalid_logo",
  UNSUPPORTED_MEDIA_TYPE: "admTheme.error_invalid_logo",
};

/**
 * Translate a theme error envelope to a human, namespaced message.
 * The raw code is NEVER surfaced.
 * @param err - The parsed error envelope (or unknown value).
 * @param locale - Target locale.
 * @returns A human-readable message.
 */
export function translateThemeError(err: unknown, locale: Locale = "fr"): string {
  const code = (err as ThemeErrorEnvelope | null | undefined)?.error?.code;
  const key = typeof code === "string" ? THEME_ERROR_KEYS[code] : undefined;
  return tAdmTheme(key ?? "admTheme.error_generic", locale);
}
