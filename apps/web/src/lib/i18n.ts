/**
 * i18n — FR labels base, extensible to 4 languages.
 * @module lib/i18n
 */

/** Supported locales */
export const SUPPORTED_LOCALES = ["fr", "dioula", "baoule", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Navigation label keys */
export type NavKey =
  | "nav.dashboard"
  | "nav.admin"
  | "nav.agent"
  | "nav.audit"
  | "nav.logout"
  | "nav.manager"
  | "nav.home";

/** All translation keys */
export type TranslationKey =
  | NavKey
  | "auth.login"
  | "auth.email"
  | "auth.password"
  | "auth.submit"
  | "auth.error"
  | "error.service_unavailable"
  | "error.403"
  | "error.403_message"
  | "error.go_to_dashboard"
  | "offline.banner"
  | "loading";

/** Translation dictionary type */
export type TranslationDict = Record<TranslationKey, string>;

/** French translations (base locale) */
export const FR: TranslationDict = {
  "nav.dashboard": "Tableau de bord",
  "nav.admin": "Administration",
  "nav.agent": "Guichet",
  "nav.audit": "Audit",
  "nav.logout": "Déconnexion",
  "nav.manager": "Gestion",
  "nav.home": "Accueil",
  "auth.login": "Connexion",
  "auth.email": "Adresse email",
  "auth.password": "Mot de passe",
  "auth.submit": "Se connecter",
  "auth.error": "Identifiants invalides",
  "error.service_unavailable": "Service indisponible",
  "error.403": "Accès refusé",
  "error.403_message": "Vous n'avez pas les droits pour accéder à cette page.",
  "error.go_to_dashboard": "Retour au tableau de bord",
  "offline.banner": "Mode hors ligne — données depuis le cache",
  loading: "Chargement…",
};

/** English translations */
export const EN: TranslationDict = {
  "nav.dashboard": "Dashboard",
  "nav.admin": "Administration",
  "nav.agent": "Counter",
  "nav.audit": "Audit",
  "nav.logout": "Logout",
  "nav.manager": "Management",
  "nav.home": "Home",
  "auth.login": "Login",
  "auth.email": "Email address",
  "auth.password": "Password",
  "auth.submit": "Sign in",
  "auth.error": "Invalid credentials",
  "error.service_unavailable": "Service unavailable",
  "error.403": "Access denied",
  "error.403_message": "You do not have permission to access this page.",
  "error.go_to_dashboard": "Back to dashboard",
  "offline.banner": "Offline mode — data from cache",
  loading: "Loading…",
};

/** Dioula translations (Mandé language, Burkina Faso / Côte d'Ivoire) */
export const DIOULA: TranslationDict = {
  "nav.dashboard": "Tableau de bord",
  "nav.admin": "Kalanden",
  "nav.agent": "Guichet",
  "nav.audit": "Lajɛ",
  "nav.logout": "Bɔ",
  "nav.manager": "Talikɛla",
  "nav.home": "So",
  "auth.login": "Dòmini",
  "auth.email": "Email",
  "auth.password": "Gundo",
  "auth.submit": "Dòmini",
  "auth.error": "Tɔgɔ walima gundo tɛ ɲɛ",
  "error.service_unavailable": "Baara tɛ sɔrɔ",
  "error.403": "Sɔrɔ tɛ",
  "error.403_message": "I tɛ se ka don nin faan in na.",
  "error.go_to_dashboard": "Segin tableau de bord la",
  "offline.banner": "Internet tɛ sɔrɔ — kunnafoni bɔra cache la",
  loading: "A bɛ nɛgɛn…",
};

/** Baoulé translations (Akan language, Côte d'Ivoire) */
export const BAOULE: TranslationDict = {
  "nav.dashboard": "Tableau de bord",
  "nav.admin": "Nzuɛ'n",
  "nav.agent": "Guichet",
  "nav.audit": "Nian",
  "nav.logout": "Fite",
  "nav.manager": "Nzuɛ'n",
  "nav.home": "Fie",
  "auth.login": "Wlu",
  "auth.email": "Email",
  "auth.password": "Nzɔnzɔn",
  "auth.submit": "Wlu",
  "auth.error": "Ɲanmiɛn su gua'n timan",
  "error.service_unavailable": "Sɛɛvisi'n nianman",
  "error.403": "Wlu kpɛ'n nianman",
  "error.403_message": "Amun wunman ase ka fie sɔ'n nun.",
  "error.go_to_dashboard": "Sɛ kɔ tableau de bord'n su",
  "offline.banner": "Internet nianman — ɔ fa cache su ninnge'n",
  loading: "Ɔ nian…",
};

/** All locales map */
export const LOCALES: Record<Locale, TranslationDict> = {
  fr: FR,
  dioula: DIOULA,
  baoule: BAOULE,
  en: EN,
};

/**
 * Gets a translation for a key in the given locale.
 * Falls back to French if key not found.
 * @param key - Translation key
 * @param locale - Target locale (default: "fr")
 * @returns Translated string
 */
export function t(key: TranslationKey, locale: Locale = "fr"): string {
  return LOCALES[locale][key] ?? FR[key] ?? key;
}
