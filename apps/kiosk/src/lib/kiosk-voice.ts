/**
 * KIOSK-008 — Logique pure de synthèse vocale + mode accessibilité.
 *
 * Regroupe la logique métier indépendante du rendu React :
 *   - registre SIGFA du texte annoncé (via traduction injectée) ;
 *   - mapping locale de session → BCP-47 (FR/EN), avec repli FR pour toute
 *     locale sans voix native (fallback explicitement documenté) ;
 *   - sélection d'une voix `SpeechSynthesisVoice` avec repli FR ;
 *   - `rate` ralentie (0.8) en mode accessibilité ;
 *   - facteurs de taille de police (28 px × 1.2) et de délais (× 2) ;
 *   - calcul de contraste WCAG (preuve ≥ 7:1 sans dépendance axe-core runtime).
 *
 * @module lib/kiosk-voice
 */

/** Facteur de rate en mode accessibilité (voix ralentie). */
export const A11Y_VOICE_RATE = 0.8 as const;

/** Rate nominale de la synthèse vocale. */
export const NOMINAL_VOICE_RATE = 1 as const;

/** Taille de police de base des textes (px). */
export const A11Y_BASE_FONT_PX = 28 as const;

/** Interligne appliqué en mode accessibilité (base × ce facteur). */
export const A11Y_LINE_HEIGHT = 1.2 as const;

/** Délai de retour accueil nominal au Moment Ticket (ms). */
export const NOMINAL_TICKET_RETURN_MS = 4000 as const;

/** Délai de retour accueil au Moment Ticket en accessibilité (ms). */
export const A11Y_TICKET_RETURN_MS = 8000 as const;

/**
 * BCP-47 des locales disposant d'une voix synthétique (FR/EN).
 * Toute locale absente de cette table retombe sur le repli FR (documenté).
 */
const LOCALE_BCP47: Record<string, string> = {
  fr: "fr-FR",
  en: "en-US",
};

/** Locale BCP-47 de repli lorsqu'aucune voix native n'existe. */
const FALLBACK_BCP47 = "fr-FR" as const;

/** Entrées d'une annonce vocale (registre SIGFA). */
export interface VoiceAnnouncementInput {
  displayNumber: string;
  position: number;
  estimatedWaitMinutes: number;
}

/** Signature minimale d'une fonction de traduction next-intl. */
export type TranslateFn = (
  key: string,
  values?: Record<string, string | number>
) => string;

/**
 * Construit le texte annoncé au registre SIGFA à partir de la traduction
 * `voiceAnnounce` (« Ticket {displayNumber}. Vous êtes {position}ᵉ dans la
 * file. Environ {estimatedWaitMinutes} minutes. ») dans la langue de session.
 *
 * @param input - Données du ticket.
 * @param t - Fonction de traduction (next-intl) scoping le namespace ticket.
 * @returns Le texte prêt à être synthétisé.
 */
export function buildVoiceAnnouncement(
  input: VoiceAnnouncementInput,
  t: TranslateFn
): string {
  return t("voiceAnnounce", {
    displayNumber: input.displayNumber,
    position: input.position,
    minutes: input.estimatedWaitMinutes,
  });
}

/**
 * Mappe une locale de session vers un tag BCP-47 pour la synthèse vocale.
 * Locale inconnue ou sans voix native → repli FR.
 *
 * @param locale - Locale de session (`fr` | `en` | …).
 * @returns Le tag BCP-47 cible.
 */
export function localeToBcp47(locale: string): string {
  return LOCALE_BCP47[locale] ?? FALLBACK_BCP47;
}

/**
 * Sélectionne une voix pour la locale cible parmi les voix disponibles.
 * Stratégie : voix exacte du BCP-47 cible → voix de même préfixe de langue →
 * repli sur une voix FR. Retourne `null` si aucune voix n'existe (dégradation
 * silencieuse, aucune erreur).
 *
 * @param locale - Locale de session.
 * @param voices - Voix disponibles (`speechSynthesis.getVoices()`).
 * @returns La voix retenue, ou `null`.
 */
export function pickVoiceForLocale(
  locale: string,
  voices: readonly SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;

  const target = localeToBcp47(locale);
  const targetPrefix = target.split("-")[0];

  const exact = voices.find((v) => v.lang === target);
  if (exact) return exact;

  const byPrefix = voices.find(
    (v) => v.lang.split("-")[0] === targetPrefix
  );
  if (byPrefix) return byPrefix;

  // Repli FR explicite (toute locale sans voix native disponible).
  const frFallback = voices.find((v) => v.lang.split("-")[0] === "fr");
  return frFallback ?? null;
}

/**
 * Rate de la synthèse vocale selon le mode.
 *
 * @param isAccessibilityMode - Vrai si le mode accessibilité est actif.
 * @returns 0.8 en accessibilité, 1 sinon.
 */
export function voiceRate(isAccessibilityMode: boolean): number {
  return isAccessibilityMode ? A11Y_VOICE_RATE : NOMINAL_VOICE_RATE;
}

/**
 * Taille de police accessibilité : base 28 px × 1.2 = 33.6 px, arrondie au
 * pixel supérieur pour garantir ≥ 34 px.
 *
 * @returns La taille en pixels (≥ 34).
 */
export function accessibilityFontSizePx(): number {
  return Math.ceil(A11Y_BASE_FONT_PX * A11Y_LINE_HEIGHT);
}

/**
 * Applique le facteur d'accessibilité à un délai (× 2 si actif).
 *
 * @param baseMs - Délai nominal en ms.
 * @param isAccessibilityMode - Vrai si le mode accessibilité est actif.
 * @returns Le délai éventuellement doublé.
 */
export function accessibilityTimeoutMs(
  baseMs: number,
  isAccessibilityMode: boolean
): number {
  return isAccessibilityMode ? baseMs * 2 : baseMs;
}

/**
 * Délai de retour accueil au Moment Ticket : 8 s en accessibilité, 4 s sinon.
 *
 * @param isAccessibilityMode - Vrai si le mode accessibilité est actif.
 * @returns Le délai en ms.
 */
export function ticketReturnDelayMs(isAccessibilityMode: boolean): number {
  return isAccessibilityMode ? A11Y_TICKET_RETURN_MS : NOMINAL_TICKET_RETURN_MS;
}

/** Composantes RGB (0–255). */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Convertit une couleur hex `#rrggbb` en composantes RGB.
 *
 * @param hex - Couleur hexadécimale (`#rrggbb`).
 * @returns Les composantes RGB.
 */
export function parseHexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/** Luminance relative WCAG d'une composante (0–1) après linéarisation. */
function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Luminance relative WCAG d'une couleur.
 *
 * @param rgb - Couleur RGB.
 * @returns La luminance relative (0–1).
 */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

/**
 * Ratio de contraste WCAG entre deux couleurs (symétrique, 1:1 à 21:1).
 *
 * @param a - Première couleur.
 * @param b - Seconde couleur.
 * @returns Le ratio de contraste.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
