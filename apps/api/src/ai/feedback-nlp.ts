/**
 * IA-004 — Moteur NLP des feedbacks clients (FR/EN uniquement).
 *
 * Modèle **intra-infra SIGFA** : classification lexicale déterministe et
 * interprétable (aide à l'explicabilité, exigence PRD). **ZÉRO appel réseau** :
 * aucune dépendance sortante, aucun service tiers. Tout le traitement est en
 * mémoire, ce qui garantit qu'aucune donnée de feedback (même expurgée) ne quitte
 * l'infra du tenant (cf. hors-scope constitution §5).
 *
 * ## Périmètre linguistique — FR/EN UNIQUEMENT (décision PO)
 * {@link detectLanguage} renvoie `fr`, `en` ou `unsupported`. Un feedback
 * `unsupported` n'est JAMAIS classé (ni sentiment ni thème) — il est marqué et
 * exclu du scoring, mais conservé brut pour revue manuelle par l'appelant.
 *
 * ## Sortie par commentaire
 * {@link analyzeComment} produit `{ language, sentiment, sentimentScore, themes }` :
 * - `sentiment` ∈ {`positive`,`neutral`,`negative`} + score continu [-1, 1] ;
 * - `themes` : sous-ensemble de l'enum FERMÉ {@link FEEDBACK_THEMES} (CONTRACT-008)
 *   — jamais de thème libre (zéro fuite de verbatim/PII).
 *
 * ## PII
 * L'analyse opère sur le texte APRÈS rédaction PII (voir `pii-redaction.ts`) :
 * les jetons masqués (`[TÉL]`, `[NOM]`…) sont neutres pour la lexique.
 *
 * @module
 */

import { redactPii } from "src/ai/pii-redaction.js";

/** Enum FERMÉ des thèmes de feedback (LA LOI `FeedbackTheme`, CONTRACT-008). */
export const FEEDBACK_THEMES = [
  "WAIT_TIME",
  "STAFF_ATTITUDE",
  "SERVICE_QUALITY",
  "CLEANLINESS",
  "DIGITAL_EXPERIENCE",
  "ACCESSIBILITY",
  "OTHER",
] as const;

/** Thème de feedback (élément de {@link FEEDBACK_THEMES}). */
export type FeedbackTheme = (typeof FEEDBACK_THEMES)[number];

/** Langue supportée par le NLP (LA LOI `FeedbackLanguage`). */
export type FeedbackLanguage = "fr" | "en" | "unsupported";

/** Étiquette de sentiment (LA LOI `SentimentBreakdown` / `RecurrentTheme`). */
export type SentimentLabel = "positive" | "neutral" | "negative";

/** Résultat d'analyse d'un commentaire unique. */
export interface CommentAnalysis {
  /** Langue détectée. `unsupported` ⇒ sentiment=neutral/score=0/themes=[] (non classé). */
  readonly language: FeedbackLanguage;
  /** Sentiment discret. */
  readonly sentiment: SentimentLabel;
  /** Score de sentiment continu dans [-1, 1] (négatif→positif). */
  readonly sentimentScore: number;
  /** Thèmes détectés (sous-ensemble de l'enum fermé), possiblement vide. */
  readonly themes: readonly FeedbackTheme[];
  /** `true` si non analysé (langue hors périmètre) — exclu du scoring. */
  readonly excluded: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Détection de langue (FR/EN vs unsupported)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marqueurs de langue française (mots fréquents + termes métier spécifiquement FR).
 * Sert uniquement à la DÉTECTION de langue (vote FR vs EN), pas au sentiment.
 */
const FR_STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "et", "est", "était", "étaient", "trop",
  "très", "pas", "bien", "mais", "avec", "pour", "dans", "sur", "au", "aux", "du",
  "de", "je", "ni", "malgré", "tout", "aujourd", "hui", "c", "d", "l",
  "attente", "accueil", "personnel", "propre", "sale", "long", "rapide", "lent",
  "merci", "bonjour", "guichet", "agence", "temps", "service", "accès", "handicap",
  "rampe", "ascenseur", "borne", "numérique", "digitale", "propreté", "hygiène",
  "absent", "insuffisante", "interminable", "aimable", "impoli", "compétent",
  "efficace", "excellent", "mauvais", "satisfait", "souriant", "panne",
]);

/**
 * Marqueurs de langue anglaise (mots fréquents + termes métier spécifiquement EN).
 * Sert uniquement à la DÉTECTION de langue (vote FR vs EN), pas au sentiment.
 */
const EN_STOPWORDS = new Set([
  "the", "a", "an", "and", "is", "was", "were", "too", "very", "not", "well",
  "but", "with", "for", "in", "on", "at", "of", "i", "no", "this", "that",
  "here", "there", "my", "your", "today",
  "waiting", "welcome", "staff", "clean", "dirty", "long", "fast", "slow",
  "thanks", "hello", "counter", "branch", "time", "service", "access",
  "accessibility", "wheelchair", "elevator", "kiosk", "digital", "online",
  "screen", "cleanliness", "hygiene", "tidy", "friendly", "rude", "helpful",
  "competent", "efficient", "excellent", "satisfied", "broken", "poor",
  "disappointing", "unpleasant", "endless", "terrible", "unacceptable",
]);

/**
 * Détecte la langue d'un commentaire : `fr`, `en`, ou `unsupported`.
 *
 * Heuristique déterministe : compte les mots-outils FR vs EN. La langue gagnante
 * doit atteindre une couverture minimale des tokens (`MIN_COVERAGE`) — sinon le
 * texte est jugé hors périmètre (`unsupported`) plutôt que classé au hasard.
 *
 * @param raw - Commentaire brut (avant ou après rédaction PII).
 * @returns Langue détectée.
 */
export function detectLanguage(raw: string | null | undefined): FeedbackLanguage {
  const tokens = tokenize(raw);
  if (tokens.length === 0) return "unsupported";
  let fr = 0;
  let en = 0;
  for (const t of tokens) {
    if (FR_STOPWORDS.has(t)) fr += 1;
    if (EN_STOPWORDS.has(t)) en += 1;
  }
  const hits = Math.max(fr, en);
  // Couverture minimale : au moins un marqueur, et ≥ 15 % des tokens reconnus
  // OU au moins 2 marqueurs (textes courts). En deçà → unsupported.
  const coverage = hits / tokens.length;
  const enough = hits >= 2 || (hits >= 1 && coverage >= 0.15);
  if (!enough) return "unsupported";
  if (fr === en) {
    // Départage sur les diacritiques FR (é, è, à, ç…) présents dans le texte brut.
    return /[àâäçéèêëîïôöùûü]/i.test(raw ?? "") ? "fr" : "en";
  }
  return fr > en ? "fr" : "en";
}

/**
 * Découpe un texte en tokens minuscules (lettres uniquement). Les apostrophes
 * (élisions FR `d'`, `l'`, `c'`, `qu'`…) sont traitées comme des séparateurs afin
 * d'isoler le mot porteur (`d'attente` → `attente`), ce qui améliore la détection
 * de lexique et de thème.
 */
function tokenize(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .toLowerCase()
    .split(/[^a-zà-ÿ]+/u)
    .filter((t) => t.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sentiment (lexique bilingue signé)
// ─────────────────────────────────────────────────────────────────────────────

/** Lexique de sentiment : token → poids [-1, 1] (FR + EN mélangés). */
const SENTIMENT_LEXICON: ReadonlyMap<string, number> = new Map([
  // Positif FR
  ["excellent", 1], ["parfait", 1], ["super", 0.8], ["rapide", 0.6],
  ["accueillant", 0.8], ["aimable", 0.7], ["propre", 0.6], ["efficace", 0.7],
  ["merci", 0.5], ["satisfait", 0.7], ["agréable", 0.7], ["compétent", 0.7],
  ["bien", 0.5], ["bon", 0.5], ["souriant", 0.7],
  // Positif EN
  ["great", 1], ["perfect", 1], ["fast", 0.6], ["friendly", 0.8],
  ["clean", 0.6], ["efficient", 0.7], ["thanks", 0.5], ["satisfied", 0.7],
  ["pleasant", 0.7], ["helpful", 0.7], ["good", 0.5], ["nice", 0.6],
  // Négatif FR
  ["lent", -0.6], ["long", -0.5], ["sale", -0.7], ["désagréable", -0.8],
  ["nul", -0.9], ["horrible", -1], ["catastrophe", -1], ["incompétent", -0.8],
  ["unpleasant", -0.7],
  ["attente", -0.4], ["mauvais", -0.7], ["mauvaise", -0.7], ["impoli", -0.8], ["décevant", -0.7],
  ["inadmissible", -0.9], ["panne", -0.7], ["interminable", -0.8],
  ["insuffisant", -0.6], ["insuffisante", -0.6], ["absent", -0.6],
  // Négatif EN
  ["slow", -0.6], ["dirty", -0.7], ["rude", -0.8], ["terrible", -1],
  ["awful", -1], ["bad", -0.7], ["incompetent", -0.8], ["disappointing", -0.7],
  ["unacceptable", -0.9], ["waiting", -0.4], ["broken", -0.7], ["poor", -0.6],
  ["missing", -0.6], ["endless", -0.8], ["no", -0.4],
]);

/** Négateurs FR/EN qui inversent le token suivant. */
const NEGATORS = new Set(["pas", "ne", "non", "not", "no", "never", "jamais", "sans", "without"]);

/** Seuil au-delà duquel un score continu bascule en positif/négatif. */
const SENTIMENT_THRESHOLD = 0.15;

/**
 * Calcule un score de sentiment continu [-1, 1] pour un texte (négation gérée
 * sur le token suivant). La moyenne des tokens porteurs de sentiment est clampée.
 *
 * @param text - Texte (idéalement déjà rédigé PII).
 * @returns Score dans [-1, 1] (0 si aucun token porteur).
 */
export function sentimentScore(text: string): number {
  const tokens = tokenize(text);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const w = SENTIMENT_LEXICON.get(tokens[i]!);
    if (w === undefined) continue;
    const negated = i > 0 && NEGATORS.has(tokens[i - 1]!);
    sum += negated ? -w : w;
    count += 1;
  }
  if (count === 0) return 0;
  const avg = sum / count;
  return Math.max(-1, Math.min(1, avg));
}

/** Convertit un score continu en étiquette discrète (seuil symétrique). */
export function labelFromScore(score: number): SentimentLabel {
  if (score > SENTIMENT_THRESHOLD) return "positive";
  if (score < -SENTIMENT_THRESHOLD) return "negative";
  return "neutral";
}

// ─────────────────────────────────────────────────────────────────────────────
// Thèmes (lexique bilingue → enum fermé)
// ─────────────────────────────────────────────────────────────────────────────

/** Table thème → mots-clés déclencheurs (FR + EN). */
const THEME_KEYWORDS: ReadonlyArray<readonly [FeedbackTheme, readonly string[]]> = [
  ["WAIT_TIME", ["attente", "attendre", "attendu", "long", "lent", "queue", "file",
    "wait", "waiting", "slow", "delay", "line", "long"]],
  ["STAFF_ATTITUDE", ["accueil", "accueillant", "personnel", "aimable",
    "impoli", "souriant", "désagréable", "poli", "staff", "welcome", "rude",
    "friendly", "attitude", "polite", "unpleasant"]],
  ["SERVICE_QUALITY", ["service", "compétent", "incompétent", "efficace", "résolu",
    "résolution", "problème", "competent", "efficient", "resolved", "quality", "help",
    "helpful"]],
  ["CLEANLINESS", ["propre", "sale", "propreté", "hygiène", "clean", "dirty",
    "cleanliness", "hygiene", "tidy"]],
  ["DIGITAL_EXPERIENCE", ["borne", "application", "appli", "digital", "site", "web",
    "kiosk", "app", "online", "screen", "écran"]],
  ["ACCESSIBILITY", ["accès", "handicap", "rampe", "ascenseur", "parking",
    "accessibilité", "access", "wheelchair", "elevator", "accessibility"]],
];

/**
 * Détecte les thèmes d'un texte depuis l'enum fermé. Retourne `["OTHER"]` si un
 * sentiment est exprimé mais qu'aucun thème connu n'apparaît ; `[]` si le texte
 * est vide/neutre sans mot-clé.
 *
 * @param text - Texte (idéalement déjà rédigé PII).
 * @returns Thèmes détectés, dédupliqués, ordre stable (ordre de {@link THEME_KEYWORDS}).
 */
export function detectThemes(text: string): FeedbackTheme[] {
  const tokens = new Set(tokenize(text));
  const found: FeedbackTheme[] = [];
  for (const [theme, keywords] of THEME_KEYWORDS) {
    if (keywords.some((k) => tokens.has(k))) found.push(theme);
  }
  if (found.length > 0) return found;
  // Aucun thème connu : OTHER si le commentaire porte du sentiment, sinon vide.
  return sentimentScore(text) !== 0 ? ["OTHER"] : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Analyse complète d'un commentaire
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyse un commentaire brut de bout en bout : rédaction PII → détection langue →
 * (si FR/EN) sentiment + thèmes. Un commentaire `unsupported` est marqué exclu et
 * n'est jamais classé (protection anti-classification hasardeuse).
 *
 * @param raw - Commentaire client brut (peut contenir de la PII).
 * @returns Analyse structurée (jamais de PII, jamais de verbatim en clair exposé).
 */
export function analyzeComment(raw: string | null | undefined): CommentAnalysis {
  const redacted = redactPii(raw);
  const language = detectLanguage(redacted);
  if (language === "unsupported") {
    return {
      language,
      sentiment: "neutral",
      sentimentScore: 0,
      themes: [],
      excluded: true,
    };
  }
  const score = sentimentScore(redacted);
  return {
    language,
    sentiment: labelFromScore(score),
    sentimentScore: score,
    themes: detectThemes(redacted),
    excluded: false,
  };
}
