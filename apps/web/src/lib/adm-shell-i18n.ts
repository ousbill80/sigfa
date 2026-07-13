/**
 * adm-shell-i18n.ts — dedicated `admShell.*` i18n namespace (DESIGN-FIX-ADMIN).
 *
 * The shared admin shell (product header + nav) owns its own namespace so it
 * never collides with `admin.*` (WEB-006), `admTheme.*`, `admOnboard.*` or
 * `admSuper.*`. Two locales only (FR/EN — décision PO 2026-07). FR is the base;
 * EN mirrors it key-for-key. `tAdmShell` falls back to FR (then the raw key) so
 * a missing translation is never a crash.
 *
 * @module lib/adm-shell-i18n
 */
import type { Locale } from "./i18n";

/** Every `admShell.*` translation key (shared admin shell). */
export type AdmShellKey =
  | "admShell.product"
  | "admShell.title"
  | "admShell.nav_label"
  | "admShell.nav.theming"
  | "admShell.nav.onboarding"
  | "admShell.nav.kiosks";

/** Translation dictionary for the admin shell. */
export type AdmShellDict = Record<AdmShellKey, string>;

/** French translations (base locale). */
export const ADM_SHELL_FR: AdmShellDict = {
  "admShell.product": "SIGFA",
  "admShell.title": "Administration",
  "admShell.nav_label": "Navigation de l'administration",
  "admShell.nav.theming": "Identité",
  "admShell.nav.onboarding": "Onboarding",
  "admShell.nav.kiosks": "Bornes",
};

/** English translations. */
export const ADM_SHELL_EN: AdmShellDict = {
  "admShell.product": "SIGFA",
  "admShell.title": "Administration",
  "admShell.nav_label": "Administration navigation",
  "admShell.nav.theming": "Identity",
  "admShell.nav.onboarding": "Onboarding",
  "admShell.nav.kiosks": "Kiosks",
};

/** Locale → dictionary map. */
export const ADM_SHELL_LOCALES: Record<Locale, AdmShellDict> = {
  fr: ADM_SHELL_FR,
  en: ADM_SHELL_EN,
};

/**
 * Translate an `admShell.*` key. Falls back to FR, then the raw key.
 * @param key - The admin-shell key.
 * @param locale - Target locale (default `fr`).
 * @returns The translated string.
 */
export function tAdmShell(key: AdmShellKey, locale: Locale = "fr"): string {
  return ADM_SHELL_LOCALES[locale][key] ?? ADM_SHELL_FR[key] ?? key;
}

/** A single admin navigation entry. */
export interface AdmNavEntry {
  /** Route href. */
  href: string;
  /** i18n key for the label. */
  key: AdmShellKey;
}

/** The three admin consoles, in nav order (theming / onboarding / kiosks). */
export const ADM_NAV_ENTRIES: readonly AdmNavEntry[] = [
  { href: "/admin/theming", key: "admShell.nav.theming" },
  { href: "/admin/onboarding", key: "admShell.nav.onboarding" },
  { href: "/admin/kiosks", key: "admShell.nav.kiosks" },
];
