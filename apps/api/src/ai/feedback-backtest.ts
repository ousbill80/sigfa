/**
 * IA-004 — Backtest NLP sur corpus FR/EN annoté (métriques d'évaluation + biais).
 *
 * Fournit un **corpus étiqueté synthétique** FR/EN (sentiment + thème de référence)
 * et des fonctions PURES de calcul de **précision / rappel / F1** et de **matrice de
 * confusion**, ainsi que le **garde-fou anti-biais** : parité de performance FR vs EN
 * (`|F1_FR − F1_EN| ≤ TOLERANCE`). Aucune I/O, aucun appel réseau.
 *
 * Ces métriques sont **évaluables AVANT données réelles** (critères ⊛ du PRD).
 *
 * @module
 */

import {
  analyzeComment,
  type FeedbackLanguage,
  type FeedbackTheme,
  type SentimentLabel,
} from "src/ai/feedback-nlp.js";

/** Écart de F1 maximal toléré entre FR et EN (anti-biais linguistique). */
export const PARITY_TOLERANCE = 0.05;

/** Exemple annoté du corpus de backtest. */
export interface AnnotatedSample {
  /** Texte du feedback (peut contenir de la PII pour tester la rédaction). */
  readonly text: string;
  /** Langue de référence. */
  readonly language: Exclude<FeedbackLanguage, "unsupported">;
  /** Sentiment de référence. */
  readonly sentiment: SentimentLabel;
  /** Thème principal de référence (enum fermé). */
  readonly theme: FeedbackTheme;
}

/**
 * Corpus FR/EN annoté (synthétique). Équilibré FR/EN et sentiment pour permettre
 * une mesure de parité fiable. Étendu prudemment : chaque phrase contient des
 * marqueurs de langue et un lexique de sentiment/thème sans ambiguïté.
 */
export const ANNOTATED_CORPUS: readonly AnnotatedSample[] = [
  // ── Français ──────────────────────────────────────────────────────────────
  { text: "Le temps d'attente était beaucoup trop long au guichet.", language: "fr", sentiment: "negative", theme: "WAIT_TIME" },
  { text: "Accueil très aimable et personnel souriant, merci.", language: "fr", sentiment: "positive", theme: "STAFF_ATTITUDE" },
  { text: "Service efficace et agent compétent, problème résolu.", language: "fr", sentiment: "positive", theme: "SERVICE_QUALITY" },
  { text: "L'agence était sale, la propreté laisse à désirer.", language: "fr", sentiment: "negative", theme: "CLEANLINESS" },
  { text: "La borne digitale était en panne, mauvaise expérience numérique.", language: "fr", sentiment: "negative", theme: "DIGITAL_EXPERIENCE" },
  { text: "Accès handicap absent et rampe insuffisante, c'est inadmissible.", language: "fr", sentiment: "negative", theme: "ACCESSIBILITY" },
  { text: "Personnel impoli et désagréable à l'accueil.", language: "fr", sentiment: "negative", theme: "STAFF_ATTITUDE" },
  { text: "Guichet rapide, service excellent, très satisfait.", language: "fr", sentiment: "positive", theme: "SERVICE_QUALITY" },
  { text: "Attente lente et interminable au guichet, agent aimable malgré tout.", language: "fr", sentiment: "negative", theme: "WAIT_TIME" },
  { text: "Agence propre et bien tenue, hygiène parfaite.", language: "fr", sentiment: "positive", theme: "CLEANLINESS" },
  { text: "Bonjour, le service était bien et rapide aujourd'hui.", language: "fr", sentiment: "positive", theme: "SERVICE_QUALITY" },
  { text: "File d'attente interminable, c'est inadmissible.", language: "fr", sentiment: "negative", theme: "WAIT_TIME" },
  { text: "Je suis venu à l'agence ce matin pour un virement.", language: "fr", sentiment: "neutral", theme: "OTHER" },
  { text: "Le guichet ouvre à neuf heures dans cette agence.", language: "fr", sentiment: "neutral", theme: "OTHER" },

  // ── English ─────────────────────────────────────────────────────────────
  { text: "The waiting time at the counter was far too long.", language: "en", sentiment: "negative", theme: "WAIT_TIME" },
  { text: "Very friendly welcome and helpful staff, thanks.", language: "en", sentiment: "positive", theme: "STAFF_ATTITUDE" },
  { text: "Efficient service and competent agent, problem resolved.", language: "en", sentiment: "positive", theme: "SERVICE_QUALITY" },
  { text: "The branch was dirty, cleanliness was awful.", language: "en", sentiment: "negative", theme: "CLEANLINESS" },
  { text: "The digital kiosk was broken, poor online screen experience.", language: "en", sentiment: "negative", theme: "DIGITAL_EXPERIENCE" },
  { text: "Poor accessibility, no wheelchair access, disappointing elevator.", language: "en", sentiment: "negative", theme: "ACCESSIBILITY" },
  { text: "Rude and unpleasant staff at the welcome desk.", language: "en", sentiment: "negative", theme: "STAFF_ATTITUDE" },
  { text: "Fast counter, excellent service, very satisfied.", language: "en", sentiment: "positive", theme: "SERVICE_QUALITY" },
  { text: "Slow endless waiting at the counter, but a friendly agent.", language: "en", sentiment: "negative", theme: "WAIT_TIME" },
  { text: "Clean and tidy branch, perfect hygiene.", language: "en", sentiment: "positive", theme: "CLEANLINESS" },
  { text: "Hello, the service was good and fast today.", language: "en", sentiment: "positive", theme: "SERVICE_QUALITY" },
  { text: "The waiting line was terrible, unacceptable.", language: "en", sentiment: "negative", theme: "WAIT_TIME" },
  { text: "I came to the branch this morning for a transfer.", language: "en", sentiment: "neutral", theme: "OTHER" },
  { text: "The branch opens at nine in this area today.", language: "en", sentiment: "neutral", theme: "OTHER" },
];

/** Métriques pour une classe (précision/rappel/F1). */
export interface ClassMetrics {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly support: number;
}

/** Résultat d'évaluation multi-classe. */
export interface EvaluationResult {
  /** Exactitude globale (fraction correcte). */
  readonly accuracy: number;
  /** F1 macro-moyen (moyenne non pondérée des F1 par classe). */
  readonly macroF1: number;
  /** Métriques par classe (clé = libellé de classe). */
  readonly perClass: Readonly<Record<string, ClassMetrics>>;
  /** Matrice de confusion : `confusion[réel][prédit] = compte`. */
  readonly confusion: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Taille de l'échantillon évalué. */
  readonly total: number;
}

/**
 * Évalue une prédiction multi-classe : matrice de confusion, précision/rappel/F1
 * par classe, exactitude, F1 macro. Générique sur le type de label.
 *
 * @param pairs   - Paires `{ actual, predicted }`.
 * @param classes - Ensemble des classes à considérer (ordre stable des lignes/colonnes).
 * @returns Résultat d'évaluation complet.
 */
export function evaluate<L extends string>(
  pairs: ReadonlyArray<{ actual: L; predicted: L }>,
  classes: readonly L[]
): EvaluationResult {
  const confusion: Record<string, Record<string, number>> = {};
  for (const a of classes) {
    confusion[a] = {};
    for (const p of classes) confusion[a]![p] = 0;
  }
  let correct = 0;
  for (const { actual, predicted } of pairs) {
    confusion[actual]![predicted] = (confusion[actual]![predicted] ?? 0) + 1;
    if (actual === predicted) correct += 1;
  }

  const perClass: Record<string, ClassMetrics> = {};
  let f1Sum = 0;
  for (const cls of classes) {
    const tp = confusion[cls]![cls] ?? 0;
    let fp = 0;
    let fn = 0;
    let support = 0;
    for (const other of classes) {
      if (other !== cls) fp += confusion[other]![cls] ?? 0;
      support += confusion[cls]![other] ?? 0;
      if (other !== cls) fn += confusion[cls]![other] ?? 0;
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClass[cls] = { precision, recall, f1, support };
    f1Sum += f1;
  }

  const total = pairs.length;
  return {
    accuracy: total === 0 ? 0 : correct / total,
    macroF1: classes.length === 0 ? 0 : f1Sum / classes.length,
    perClass,
    confusion,
    total,
  };
}

/** Labels de sentiment évalués. */
const SENTIMENT_CLASSES: readonly SentimentLabel[] = ["positive", "neutral", "negative"];

/** Résultat de backtest complet (sentiment + thème + parité). */
export interface BacktestReport {
  /** Évaluation du sentiment sur tout le corpus. */
  readonly sentiment: EvaluationResult;
  /** Évaluation du thème sur tout le corpus. */
  readonly theme: EvaluationResult;
  /** F1 macro sentiment restreint aux exemples FR. */
  readonly f1SentimentFr: number;
  /** F1 macro sentiment restreint aux exemples EN. */
  readonly f1SentimentEn: number;
  /** Écart absolu de F1 sentiment FR vs EN. */
  readonly parityGap: number;
  /** `true` si l'écart respecte {@link PARITY_TOLERANCE} (garde-fou anti-biais). */
  readonly parityOk: boolean;
}

/**
 * Exécute le backtest sur un corpus annoté : classe chaque exemple via le moteur
 * NLP puis calcule les métriques sentiment/thème et la parité FR vs EN.
 *
 * @param corpus - Corpus annoté (défaut : {@link ANNOTATED_CORPUS}).
 * @returns Rapport de backtest (métriques + garde-fou de biais).
 */
export function runBacktest(
  corpus: readonly AnnotatedSample[] = ANNOTATED_CORPUS
): BacktestReport {
  const sentimentPairs: Array<{ actual: SentimentLabel; predicted: SentimentLabel }> = [];
  const themePairs: Array<{ actual: FeedbackTheme; predicted: FeedbackTheme }> = [];
  const frPairs: Array<{ actual: SentimentLabel; predicted: SentimentLabel }> = [];
  const enPairs: Array<{ actual: SentimentLabel; predicted: SentimentLabel }> = [];

  for (const sample of corpus) {
    const a = analyzeComment(sample.text);
    const predictedSentiment = a.sentiment;
    // Thème principal prédit = premier thème détecté (ordre stable), sinon OTHER.
    const predictedTheme: FeedbackTheme = a.themes[0] ?? "OTHER";
    sentimentPairs.push({ actual: sample.sentiment, predicted: predictedSentiment });
    themePairs.push({ actual: sample.theme, predicted: predictedTheme });
    if (sample.language === "fr") frPairs.push({ actual: sample.sentiment, predicted: predictedSentiment });
    else enPairs.push({ actual: sample.sentiment, predicted: predictedSentiment });
  }

  const themeClasses = Array.from(new Set(corpus.map((s) => s.theme)));
  const sentiment = evaluate(sentimentPairs, SENTIMENT_CLASSES);
  const theme = evaluate(themePairs, themeClasses);
  const f1SentimentFr = evaluate(frPairs, SENTIMENT_CLASSES).macroF1;
  const f1SentimentEn = evaluate(enPairs, SENTIMENT_CLASSES).macroF1;
  const parityGap = Math.abs(f1SentimentFr - f1SentimentEn);

  return {
    sentiment,
    theme,
    f1SentimentFr,
    f1SentimentEn,
    parityGap,
    parityOk: parityGap <= PARITY_TOLERANCE,
  };
}
