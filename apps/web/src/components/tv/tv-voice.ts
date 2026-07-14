/**
 * tv-voice — annonce vocale de l'écran TV public (Web Speech API).
 *
 * Reprend LOCALEMENT le pattern éprouvé du kiosque (`apps/kiosk/src/lib/
 * kiosk-voice.ts`) : sélection d'une voix de QUALITÉ par score (exacte >
 * préfixe, voix réputées type Thomas/Amélie > ordinaires, malus novelty macOS,
 * localService/default en départage), attente BORNÉE du chargement asynchrone
 * des voix (`voiceschanged`), `cancel()` avant `speak()`, silence gracieux si
 * aucun moteur. Le kiosque est une app séparée (pas de package partagé pour
 * cette mécanique) : duplication assumée et documentée plutôt qu'un couplage
 * inter-apps.
 *
 * Forme du numéro annoncé (décision testée) : les moteurs fr-FR lisent mal
 * « OC-001 » en bloc (« oc moins un », tiret avalé) → le numéro est ÉPELÉ
 * caractère par caractère (« O C 0 0 1 » → « o, c, zéro, zéro, un »), forme la
 * plus intelligible en salle d'attente.
 *
 * ATTENTION autoplay : la plupart des navigateurs BLOQUENT `speechSynthesis.speak()`
 * avant toute interaction utilisateur. Le geste du passage en plein écran
 * (tv-fullscreen) débloque la synthèse ; avant cela l'annonce échoue en
 * SILENCE (jamais d'erreur visible — l'overlay visuel reste la garantie).
 *
 * @module components/tv/tv-voice
 */
import type { Locale } from "@/lib/i18n";

/** BCP-47 cible par locale TV (FR/EN uniquement — décision PO). */
const LOCALE_BCP47: Record<Locale, string> = {
  fr: "fr-FR",
  en: "en-US",
};

/** Locale BCP-47 de repli lorsqu'aucune voix native n'existe. */
const FALLBACK_BCP47 = "fr-FR" as const;

/**
 * Délai max (ms) d'attente du chargement asynchrone des voix
 * (`voiceschanged`) avant de parler quand même en mode dégradé.
 */
export const TV_VOICES_LOAD_TIMEOUT_MS = 1000 as const;

/**
 * Épelle un numéro de ticket pour la synthèse vocale : caractères séparés par
 * des espaces, séparateurs (tiret…) retirés. « OC-001 » → « O C 0 0 1 » : le
 * moteur fr-FR lit alors « o, c, zéro, zéro, un » — intelligible, là où le
 * bloc « OC-001 » est lu « oc moins un » par certains moteurs.
 * @param displayNumber - Numéro affiché (ex. « OC-001 »).
 * @returns Le numéro épelé, prêt à être synthétisé.
 */
export function spellTicketNumber(displayNumber: string): string {
  return displayNumber
    .split("")
    .filter((ch) => /[A-Za-z0-9]/.test(ch))
    .join(" ");
}

/**
 * Construit le texte de l'annonce vocale « Ticket {numéro épelé}, {guichet} ».
 * Le libellé guichet vient du contrat (`counter.label`, ex. « Guichet 3 ») et
 * se lit naturellement tel quel dans les deux langues.
 * @param displayNumber - Numéro affiché (ex. « OC-001 »).
 * @param counterLabel - Libellé du guichet (ex. « Guichet 3 »).
 * @param locale - Locale d'annonce.
 * @returns Le texte à synthétiser.
 */
export function tvAnnouncementText(
  displayNumber: string,
  counterLabel: string,
  locale: Locale
): string {
  const spelled = spellTicketNumber(displayNumber);
  if (locale === "en") return `Ticket ${spelled}, ${counterLabel}`;
  return `Ticket ${spelled}, ${counterLabel}`;
}

/**
 * Voix réputées de bonne qualité, par préfixe de langue (correspondance par
 * sous-chaîne insensible à la casse) — même liste que le kiosque (retour PO :
 * la PREMIÈRE voix qui matche peut être robotique bas de gamme).
 */
const QUALITY_VOICE_NAMES: Readonly<Record<string, readonly string[]>> = {
  en: ["google us english", "samantha", "ava", "allison", "zoe", "karen", "daniel"],
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
const QUALITY_NAME_HINTS: readonly string[] = ["enhanced", "premium", "natural", "neural"];

/** Voix macOS robotiques/novelty connues → malus fort (dernier recours). */
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

/* Barème : critères principaux espacés d'au moins 10 points ; localService
   (+2) puis default (+1) ne servent QUE de départage à score égal. */
const SCORE_EXACT_LANG = 100 as const;
const SCORE_PREFIX_LANG = 50 as const;
const SCORE_QUALITY_NAME = 30 as const;
const SCORE_QUALITY_HINT = 10 as const;
const SCORE_NOVELTY_MALUS = -80 as const;
const SCORE_LOCAL_SERVICE = 2 as const;
const SCORE_DEFAULT_VOICE = 1 as const;

/** Normalise un tag de langue (`fr_FR` → `fr-fr`) pour comparaison. */
function normalizeLang(lang: string): string {
  return lang.replace("_", "-").toLowerCase();
}

/** Score de qualité d'une voix pour un BCP-47 cible (voir barème ci-dessus). */
function scoreVoice(voice: SpeechSynthesisVoice, target: string): number {
  const name = voice.name.toLowerCase();
  const prefix = target.split("-")[0];

  let score =
    normalizeLang(voice.lang) === normalizeLang(target) ? SCORE_EXACT_LANG : SCORE_PREFIX_LANG;
  const qualityNames = QUALITY_VOICE_NAMES[prefix ?? ""] ?? [];
  if (qualityNames.some((q) => name.includes(q))) score += SCORE_QUALITY_NAME;
  if (QUALITY_NAME_HINTS.some((h) => name.includes(h))) score += SCORE_QUALITY_HINT;
  if (NOVELTY_VOICE_NAMES.some((n) => name.includes(n))) score += SCORE_NOVELTY_MALUS;
  if (voice.localService) score += SCORE_LOCAL_SERVICE;
  if (voice.default) score += SCORE_DEFAULT_VOICE;
  return score;
}

/** Meilleure voix (score max) parmi celles partageant le préfixe de langue. */
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
 * Sélectionne la meilleure voix pour la locale TV parmi les voix disponibles :
 * meilleure voix par score dans la langue cible → repli FR → `null` si aucune
 * voix (dégradation silencieuse, aucune erreur).
 * @param locale - Locale d'annonce.
 * @param voices - Voix disponibles (`speechSynthesis.getVoices()`).
 * @returns La voix retenue, ou `null`.
 */
export function pickTvVoice(
  locale: Locale,
  voices: readonly SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const target = LOCALE_BCP47[locale] ?? FALLBACK_BCP47;
  return bestVoiceForBcp47(target, voices) ?? bestVoiceForBcp47(FALLBACK_BCP47, voices);
}

/** Surface minimale de `speechSynthesis` consommée (testabilité). */
export interface TvSpeechSynthesisLike {
  /** Parle l'utterance donnée. */
  speak: (utterance: SpeechSynthesisUtterance) => void;
  /** Purge la file d'annonces en cours. */
  cancel?: () => void;
  /** Voix disponibles. */
  getVoices?: () => SpeechSynthesisVoice[];
  /** Abonnement `voiceschanged`. */
  addEventListener?: (type: string, listener: () => void) => void;
  /** Désabonnement `voiceschanged`. */
  removeEventListener?: (type: string, listener: () => void) => void;
}

/** Options de {@link speakTvAnnouncement}. */
export interface SpeakTvAnnouncementOptions {
  /** Locale cible de l'annonce. */
  locale: Locale;
  /** Texte à synthétiser (voir {@link tvAnnouncementText}). */
  text: string;
}

/**
 * Prononce une annonce TV : voix de qualité explicite, attente bornée du
 * chargement asynchrone des voix, `cancel()` avant `speak()`. JAMAIS d'erreur :
 * API absente/partielle ou moteur bloqué (autoplay avant interaction) →
 * silence gracieux, l'overlay visuel reste la garantie d'information.
 * @param synth - Instance `speechSynthesis` (ou double de test), ou null.
 * @param options - Locale et texte.
 */
export function speakTvAnnouncement(
  synth: TvSpeechSynthesisLike | null | undefined,
  options: SpeakTvAnnouncementOptions
): void {
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;

  const speakNow = (voices: readonly SpeechSynthesisVoice[]): void => {
    try {
      const utterance = new SpeechSynthesisUtterance(options.text);
      utterance.lang = LOCALE_BCP47[options.locale] ?? FALLBACK_BCP47;
      const voice = pickTvVoice(options.locale, voices);
      if (voice) utterance.voice = voice;
      // Purge une annonce précédente encore en cours AVANT de parler.
      synth.cancel?.();
      synth.speak(utterance);
    } catch (err) {
      // Best-effort (moteur bloqué avant interaction, API partielle…).
      console.error("[tv-voice] speech failed", err);
    }
  };

  const voices = synth.getVoices?.() ?? [];
  if (voices.length > 0 || typeof synth.addEventListener !== "function") {
    speakNow(voices);
    return;
  }

  // Liste vide : vrai « aucune voix » OU chargement asynchrone pas terminé
  // (Chrome/WebView). On attend `voiceschanged` une seule fois, borné : au-delà
  // on parle quand même (dégradation : voix par défaut du moteur).
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
  timer = setTimeout(onVoicesReady, TV_VOICES_LOAD_TIMEOUT_MS);
}
