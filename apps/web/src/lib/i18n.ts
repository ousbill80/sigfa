/**
 * i18n — FR labels base, extensible to 4 languages.
 * @module lib/i18n
 */

/** Supported locales */
export const SUPPORTED_LOCALES = ["fr", "en", "ar", "mg"] as const;
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

/** Arabic translations (RTL) */
export const AR: TranslationDict = {
  "nav.dashboard": "لوحة التحكم",
  "nav.admin": "الإدارة",
  "nav.agent": "الشباك",
  "nav.audit": "التدقيق",
  "nav.logout": "تسجيل الخروج",
  "nav.manager": "الإدارة",
  "nav.home": "الرئيسية",
  "auth.login": "تسجيل الدخول",
  "auth.email": "البريد الإلكتروني",
  "auth.password": "كلمة المرور",
  "auth.submit": "دخول",
  "auth.error": "بيانات الاعتماد غير صالحة",
  "error.service_unavailable": "الخدمة غير متاحة",
  "error.403": "وصول مرفوض",
  "error.403_message": "ليس لديك إذن للوصول إلى هذه الصفحة.",
  "error.go_to_dashboard": "العودة إلى لوحة التحكم",
  "offline.banner": "وضع عدم الاتصال — البيانات من ذاكرة التخزين المؤقت",
  loading: "جارٍ التحميل…",
};

/** Malagasy translations */
export const MG: TranslationDict = {
  "nav.dashboard": "Tableau de bord",
  "nav.admin": "Fitantanana",
  "nav.agent": "Guichet",
  "nav.audit": "Audit",
  "nav.logout": "Hiala",
  "nav.manager": "Fitantanana",
  "nav.home": "Fandraisana",
  "auth.login": "Fidirana",
  "auth.email": "Adiresy email",
  "auth.password": "Tenimiafina",
  "auth.submit": "Hiditra",
  "auth.error": "Tsy mety ny fanamarinana",
  "error.service_unavailable": "Tsy misy ny serivisy",
  "error.403": "Tsy avela miditra",
  "error.403_message": "Tsy manana alalana ianao hidiitra ity pejy ity.",
  "error.go_to_dashboard": "Hiverina amin'ny tableau de bord",
  "offline.banner": "Mode tsy misy internet — angona avy amin'ny cache",
  loading: "Miandry…",
};

/** All locales map */
export const LOCALES: Record<Locale, TranslationDict> = {
  fr: FR,
  en: EN,
  ar: AR,
  mg: MG,
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
