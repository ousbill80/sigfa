/**
 * adm-theme-i18n.ts — dedicated `admTheme.*` i18n namespace (ADM-001b).
 *
 * The theming console owns its own namespace so it never collides with the
 * existing `admin.*` keys (WEB-006) nor the `audit.*` / `ai.*` / `pwa.*` ones.
 * Two locales only (FR/EN — décision PO 2026-07). FR is the base; EN mirrors it
 * key-for-key. `tAdmTheme` falls back to FR (then the raw key) so a missing
 * translation is never a crash.
 *
 * @module lib/adm-theme-i18n
 */
import type { Locale } from "./i18n";

/** Every `admTheme.*` translation key (theming console). */
export type AdmThemeKey =
  | "admTheme.title"
  | "admTheme.subtitle"
  | "admTheme.habillage_notice"
  | "admTheme.brand_label"
  | "admTheme.brand_hint"
  | "admTheme.brand_picker_label"
  | "admTheme.welcome_fr_label"
  | "admTheme.welcome_en_label"
  | "admTheme.welcome_hint"
  | "admTheme.logo_label"
  | "admTheme.logo_hint"
  | "admTheme.logo_upload"
  | "admTheme.logo_placeholder"
  | "admTheme.logo_error"
  | "admTheme.preview_title"
  | "admTheme.preview_button"
  | "admTheme.preview_badge"
  | "admTheme.preview_header"
  | "admTheme.contrast_label"
  | "admTheme.contrast_pass"
  | "admTheme.contrast_warning"
  | "admTheme.applied_value"
  | "admTheme.save"
  | "admTheme.saved"
  | "admTheme.error_invalid_brand"
  | "admTheme.error_unknown_field"
  | "admTheme.error_invalid_logo"
  | "admTheme.error_generic"
  | "admTheme.state_loading"
  | "admTheme.state_empty"
  | "admTheme.state_error"
  | "admTheme.state_offline"
  | "admTheme.forbidden";

/** Translation dictionary for the theming console. */
export type AdmThemeDict = Record<AdmThemeKey, string>;

/** French translations (base locale). */
export const ADM_THEME_FR: AdmThemeDict = {
  "admTheme.title": "IDENTITÉ DE LA BANQUE",
  "admTheme.subtitle": "Personnalisez la couleur, le logo et les messages d'accueil de votre banque.",
  "admTheme.habillage_notice":
    "Le theming est un habillage, jamais la structure : seuls la couleur, le logo et les messages d'accueil changent. La mise en page reste identique.",
  "admTheme.brand_label": "Couleur principale (--brand)",
  "admTheme.brand_hint": "Format hexadécimal, ex. #003f7f.",
  "admTheme.brand_picker_label": "Sélecteur de couleur",
  "admTheme.welcome_fr_label": "Message d'accueil (français)",
  "admTheme.welcome_en_label": "Message d'accueil (anglais)",
  "admTheme.welcome_hint": "Texte court affiché aux clients (200 caractères max).",
  "admTheme.logo_label": "Logo de la banque",
  "admTheme.logo_hint": "PNG, SVG ou JPEG, ≥ 200×200 px, ≤ 2 Mo.",
  "admTheme.logo_upload": "Téléverser un logo",
  "admTheme.logo_placeholder": "Aucun logo — le nom de la banque est affiché.",
  "admTheme.logo_error": "Logo non appliqué : {reason}. L'ancien logo reste actif.",
  "admTheme.preview_title": "Aperçu en temps réel",
  "admTheme.preview_button": "Action principale",
  "admTheme.preview_badge": "Étiquette",
  "admTheme.preview_header": "En-tête",
  "admTheme.contrast_label": "Contraste du texte sur la couleur",
  "admTheme.contrast_pass": "Contraste conforme (≥ 4,5:1).",
  "admTheme.contrast_warning": "Contraste insuffisant (< 4,5:1) — la couleur sera assombrie automatiquement.",
  "admTheme.applied_value": "Valeur appliquée",
  "admTheme.save": "Enregistrer",
  "admTheme.saved": "Identité enregistrée.",
  "admTheme.error_invalid_brand": "Couleur invalide : format hexadécimal #RRGGBB attendu.",
  "admTheme.error_unknown_field": "Champ non autorisé : le theming n'accepte aucun token de structure.",
  "admTheme.error_invalid_logo": "Logo invalide : format non supporté ou dimensions insuffisantes.",
  "admTheme.error_generic": "Une erreur est survenue. Veuillez réessayer.",
  "admTheme.state_loading": "Chargement de l'identité…",
  "admTheme.state_empty": "Aucune identité configurée pour le moment.",
  "admTheme.state_error": "Impossible de charger l'identité. Veuillez réessayer.",
  "admTheme.state_offline": "Connexion requise pour configurer.",
  "admTheme.forbidden": "Vous n'avez pas les droits pour configurer l'identité de la banque.",
};

/** English translations. */
export const ADM_THEME_EN: AdmThemeDict = {
  "admTheme.title": "BANK IDENTITY",
  "admTheme.subtitle": "Customise your bank's colour, logo and welcome messages.",
  "admTheme.habillage_notice":
    "Theming is a skin, never the structure: only the colour, logo and welcome messages change. The layout stays identical.",
  "admTheme.brand_label": "Primary colour (--brand)",
  "admTheme.brand_hint": "Hexadecimal format, e.g. #003f7f.",
  "admTheme.brand_picker_label": "Colour picker",
  "admTheme.welcome_fr_label": "Welcome message (French)",
  "admTheme.welcome_en_label": "Welcome message (English)",
  "admTheme.welcome_hint": "Short text shown to customers (200 characters max).",
  "admTheme.logo_label": "Bank logo",
  "admTheme.logo_hint": "PNG, SVG or JPEG, ≥ 200×200 px, ≤ 2 MB.",
  "admTheme.logo_upload": "Upload a logo",
  "admTheme.logo_placeholder": "No logo — the bank name is shown.",
  "admTheme.logo_error": "Logo not applied: {reason}. The previous logo stays active.",
  "admTheme.preview_title": "Live preview",
  "admTheme.preview_button": "Primary action",
  "admTheme.preview_badge": "Label",
  "admTheme.preview_header": "Header",
  "admTheme.contrast_label": "Text contrast on the colour",
  "admTheme.contrast_pass": "Contrast passes (≥ 4.5:1).",
  "admTheme.contrast_warning": "Insufficient contrast (< 4.5:1) — the colour will be darkened automatically.",
  "admTheme.applied_value": "Applied value",
  "admTheme.save": "Save",
  "admTheme.saved": "Identity saved.",
  "admTheme.error_invalid_brand": "Invalid colour: hexadecimal #RRGGBB format expected.",
  "admTheme.error_unknown_field": "Field not allowed: theming accepts no structure token.",
  "admTheme.error_invalid_logo": "Invalid logo: unsupported format or dimensions too small.",
  "admTheme.error_generic": "An error occurred. Please try again.",
  "admTheme.state_loading": "Loading identity…",
  "admTheme.state_empty": "No identity configured yet.",
  "admTheme.state_error": "Unable to load the identity. Please try again.",
  "admTheme.state_offline": "Connection required to configure.",
  "admTheme.forbidden": "You do not have permission to configure the bank identity.",
};

/** Locale → dictionary map. */
export const ADM_THEME_LOCALES: Record<Locale, AdmThemeDict> = {
  fr: ADM_THEME_FR,
  en: ADM_THEME_EN,
};

/**
 * Translate an `admTheme.*` key. Falls back to FR, then the raw key.
 * @param key - The theming console key.
 * @param locale - Target locale (default `fr`).
 * @returns The translated string.
 */
export function tAdmTheme(key: AdmThemeKey, locale: Locale = "fr"): string {
  return ADM_THEME_LOCALES[locale][key] ?? ADM_THEME_FR[key] ?? key;
}
