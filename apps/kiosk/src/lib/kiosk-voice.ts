/**
 * KIOSK-008 — Logique pure de synthèse vocale + mode accessibilité.
 *
 * Regroupe la logique métier indépendante du rendu React :
 *   - registre SIGFA du texte annoncé (via traduction injectée) ;
 *   - mapping locale de session → BCP-47 (FR/EN), avec repli FR pour toute
 *     locale sans voix native (fallback explicitement documenté) ;
 *   - sélection d'une voix `SpeechSynthesisVoice` par SCORE de qualité
 *     (exacte > préfixe, voix réputées > ordinaires, malus novelty macOS,
 *     localService puis default à score égal), avec repli FR ;
 *   - `speakInLocale` : parole dans la locale cible en gérant le chargement
 *     ASYNCHRONE des voix (`voiceschanged`) et l'annulation de l'annonce
 *     précédente — mécanique unique réutilisée par tous les écrans ;
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

/**
 * Délai de retour accueil nominal au Moment Ticket (ms).
 * Audit UX F9 (2026-07-14) : 4 s ne laissaient pas le temps de lire 6 lignes
 * ni d'écouter l'annonce vocale (~8 s) → 10 s, avec compte à rebours visible.
 */
export const NOMINAL_TICKET_RETURN_MS = 10000 as const;

/**
 * Délai de retour accueil au Moment Ticket en accessibilité/dégradé (ms).
 * Patron kiosque : délai nominal × 2 (cf. accessibilityTimeoutMs).
 */
export const A11Y_TICKET_RETURN_MS = 20000 as const;

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
  /**
   * Audit F5 : ticket émis HORS-LIGNE → position/attente locales non fiables.
   * L'annonce bascule sur le registre honnête `voiceAnnounceOffline` (numéro
   * seul + « estimées dès la reconnexion »), jamais de fausse promesse vocale.
   */
  isOffline?: boolean;
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
  // Audit F5 : chemin hors-ligne → registre honnête, sans position/attente.
  if (input.isOffline) {
    return t("voiceAnnounceOffline", {
      displayNumber: input.displayNumber,
    });
  }
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
 * Voix réputées de bonne qualité, par préfixe de langue (noms en minuscules,
 * correspondance par sous-chaîne insensible à la casse). Retour PO : « la voix
 * anglaise ne marche toujours pas bien » — la PREMIÈRE voix qui matchait la
 * locale pouvait être une voix robotique bas de gamme (Albert, Fred, compact…).
 */
const QUALITY_VOICE_NAMES: Readonly<Record<string, readonly string[]>> = {
  en: [
    "google us english",
    "samantha",
    "ava",
    "allison",
    "zoe",
    "karen",
    "daniel",
  ],
  fr: [
    "google français",
    "google francais",
    "amélie",
    "amelie",
    "thomas",
    "audrey",
    "aurélie",
    "aurelie",
    "marie",
  ],
};

/** Indices génériques de qualité dans le nom d'une voix (moteurs premium). */
const QUALITY_NAME_HINTS: readonly string[] = [
  "enhanced",
  "premium",
  "natural",
  "neural",
];

/**
 * Voix macOS robotiques/novelty connues → malus fort : elles ne doivent être
 * retenues QUE s'il n'existe aucune autre voix de la langue cible.
 */
const NOVELTY_VOICE_NAMES: readonly string[] = [
  "albert",
  "bad news",
  "bahh",
  "bells",
  "boing",
  "bubbles",
  "cellos",
  "wobble",
  "whisper",
  "zarvox",
  "trinoids",
  "ralph",
  "fred",
  "junior",
  "kathy",
  "organ",
  "superstar",
  "jester",
  "compact",
];

/**
 * Barème du score de voix. Les critères principaux sont espacés d'au moins 10
 * points ; `localService` (+2) puis `default` (+1) ne servent QUE de
 * départage à score égal (2 + 1 < 10, ils ne peuvent pas inverser un critère).
 */
const SCORE_EXACT_LANG = 100 as const;
const SCORE_PREFIX_LANG = 50 as const;
const SCORE_QUALITY_NAME = 30 as const;
const SCORE_QUALITY_HINT = 10 as const;
const SCORE_NOVELTY_MALUS = -80 as const;
const SCORE_LOCAL_SERVICE = 2 as const;
const SCORE_DEFAULT_VOICE = 1 as const;

/** Normalise un tag de langue (`en_US` → `en-us`) pour comparaison. */
function normalizeLang(lang: string): string {
  return lang.replace("_", "-").toLowerCase();
}

/**
 * Score de qualité d'une voix pour un BCP-47 cible, du meilleur au moins bon :
 *   1. correspondance BCP-47 EXACTE (+100) avant simple préfixe (+50) ;
 *   2. voix réputée de qualité pour la langue (+30), indice premium dans le
 *      nom — enhanced/premium/natural/neural — (+10) ;
 *   3. malus fort (−80) pour les voix robotiques/novelty macOS : une exacte
 *      novelty (100 − 80 = 20) perd contre n'importe quelle ordinaire (≥ 50) ;
 *   4. à score égal : `localService` (+2, pas de latence réseau) puis
 *      `default` (+1).
 */
function scoreVoice(voice: SpeechSynthesisVoice, target: string): number {
  const name = voice.name.toLowerCase();
  const prefix = target.split("-")[0];

  let score =
    normalizeLang(voice.lang) === normalizeLang(target)
      ? SCORE_EXACT_LANG
      : SCORE_PREFIX_LANG;
  const qualityNames = QUALITY_VOICE_NAMES[prefix] ?? [];
  if (qualityNames.some((q) => name.includes(q))) score += SCORE_QUALITY_NAME;
  if (QUALITY_NAME_HINTS.some((h) => name.includes(h)))
    score += SCORE_QUALITY_HINT;
  if (NOVELTY_VOICE_NAMES.some((n) => name.includes(n)))
    score += SCORE_NOVELTY_MALUS;
  if (voice.localService) score += SCORE_LOCAL_SERVICE;
  if (voice.default) score += SCORE_DEFAULT_VOICE;
  return score;
}

/**
 * Meilleure voix (score maximal) parmi celles dont la langue partage le
 * préfixe du BCP-47 cible. Stable : à score strictement égal, la première
 * voix de la liste l'emporte.
 */
function bestVoiceForBcp47(
  target: string,
  voices: readonly SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  const prefix = target.split("-")[0];
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const voice of voices) {
    if (normalizeLang(voice.lang).split("-")[0] !== prefix) continue;
    const score = scoreVoice(voice, target);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Sélectionne une voix pour la locale cible parmi les voix disponibles.
 * Stratégie : meilleure voix par SCORE de qualité (voir `scoreVoice`) parmi
 * celles de la langue cible → repli sur la meilleure voix FR (aucune voix de
 * la locale — repli documenté, inchangé). Retourne `null` si aucune voix
 * n'existe (dégradation silencieuse, aucune erreur).
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
  const best = bestVoiceForBcp47(target, voices);
  if (best) return best;

  // Repli FR explicite (toute locale sans voix native disponible).
  return bestVoiceForBcp47(FALLBACK_BCP47, voices);
}

/**
 * Délai max (ms) d'attente du chargement asynchrone des voix (`voiceschanged`)
 * avant de parler quand même en mode dégradé (`utterance.lang` seul).
 */
export const VOICES_LOAD_TIMEOUT_MS = 1000 as const;

/** Entrées de `speakInLocale`. */
export interface SpeakInLocaleOptions {
  /** Locale CIBLE de l'annonce (la langue choisie, pas celle du rendu). */
  locale: string;
  /** Texte à synthétiser. */
  text: string;
  /**
   * Rate de la voix (voir `voiceRate`). Optionnel : défaut
   * `NOMINAL_VOICE_RATE` (1.0) — un mot isolé (« Français » / « English »)
   * ralenti sonne artificiel ; seuls les textes longs (annonce ticket,
   * accessibilité) passent un rate ralenti explicite.
   */
  rate?: number;
}

/**
 * Parle `text` dans la locale cible en réutilisant la mécanique commune :
 *   1. voix explicite via `pickVoiceForLocale` (le seul `utterance.lang` ne
 *      suffit pas sur certains moteurs : sans `utterance.voice`, la voix par
 *      défaut — souvent FR — lit le texte anglais) ;
 *   2. chargement ASYNCHRONE des voix : sur Chrome/WebView le premier
 *      `getVoices()` renvoie `[]` ; on attend alors `voiceschanged` (une seule
 *      fois, borné à `VOICES_LOAD_TIMEOUT_MS`) pour que le repli FR documenté
 *      ne joue que si AUCUNE voix native n'existe réellement — jamais parce
 *      que la liste n'était pas encore chargée ;
 *   3. `cancel()` juste avant `speak()` pour purger toute annonce qui traîne.
 * Dégradation silencieuse si l'API est partielle ou absente (aucune erreur).
 *
 * @param synth - Instance `speechSynthesis` du navigateur.
 * @param options - Locale cible, texte et rate (optionnel, défaut nominal 1.0).
 */
export function speakInLocale(
  synth: SpeechSynthesis,
  options: SpeakInLocaleOptions
): void {
  if (typeof SpeechSynthesisUtterance === "undefined") return;

  const speakNow = (voices: readonly SpeechSynthesisVoice[]): void => {
    const utterance = new SpeechSynthesisUtterance(options.text);
    utterance.lang = localeToBcp47(options.locale);
    utterance.rate = options.rate ?? NOMINAL_VOICE_RATE;
    const voice = pickVoiceForLocale(options.locale, voices);
    if (voice) utterance.voice = voice;
    // Purge une éventuelle annonce précédente encore en cours AVANT de parler.
    synth.cancel?.();
    synth.speak(utterance);
  };

  const voices = synth.getVoices?.() ?? [];
  if (voices.length > 0 || typeof synth.addEventListener !== "function") {
    speakNow(voices);
    return;
  }

  // Liste vide : soit un vrai « aucune voix », soit un chargement asynchrone
  // pas encore terminé. On attend `voiceschanged` une seule fois ; au-delà du
  // délai borné, on parle quand même (dégradation : voix par défaut du moteur).
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  const onVoicesReady = (): void => {
    if (done) return;
    done = true;
    synth.removeEventListener?.("voiceschanged", onVoicesReady);
    if (timer !== undefined) clearTimeout(timer);
    speakNow(synth.getVoices?.() ?? []);
  };
  synth.addEventListener("voiceschanged", onVoicesReady);
  timer = setTimeout(onVoicesReady, VOICES_LOAD_TIMEOUT_MS);
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
 * Délai de retour accueil au Moment Ticket : 20 s en accessibilité, 10 s sinon
 * (audit F9 — compte à rebours visible, bouton « Terminer » pour sortir avant).
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
