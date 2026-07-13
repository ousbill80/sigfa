/**
 * IA-004 — Scoring qualité agrégé par agence / agent (indicatif, explicable).
 *
 * Combine la **note structurée** (feedback 1–5, API-010) et le **sentiment NLP**
 * en un `qualityScore` normalisé sur l'échelle {@link QUALITY_SCALE}, DÉCOMPOSÉ en
 * contributions (explicabilité PRD). Fonctions PURES et déterministes.
 *
 * ## Garde-fous NON NÉGOCIABLES
 * - **INSUFFICIENT_SAMPLE** : sous {@link MIN_SAMPLE_SIZE} feedbacks analysés sur la
 *   période, le score individuel n'est **pas publié** (`insufficientSample: true`,
 *   `score` masqué à `null`). Protection contre le jugement sur échantillon faible.
 * - **Aucune décision automatique** : ce module ne calcule qu'un agrégat advisory.
 *   Il n'émet aucune mutation, aucune action RH/opérationnelle. L'appelant (route)
 *   ne fait que projeter la forme contractuelle en lecture seule.
 *
 * @module
 */

import type { CommentAnalysis, FeedbackTheme, SentimentLabel } from "src/ai/feedback-nlp.js";

/** Échelle du score qualité exposé (LA LOI `QualityScore.scale`). */
export const QUALITY_SCALE = 5;

/** Seuil de publication (LA LOI `insufficientSample`, défaut < 30 feedbacks). */
export const MIN_SAMPLE_SIZE = 30;

/**
 * Poids de la note structurée dans le score composite (le sentiment porte le
 * complément). Somme = 1. Choix interprétable : la note explicite prime.
 */
export const STRUCTURED_WEIGHT = 0.6;
/** Poids du sentiment NLP dans le score composite. */
export const SENTIMENT_WEIGHT = 1 - STRUCTURED_WEIGHT;

/** Un feedback analysé (note structurée éventuelle + analyse NLP du commentaire). */
export interface AnalyzedFeedback {
  /** Note structurée 1–5 (API-010), ou `null` si absente. */
  readonly rating: number | null;
  /** Analyse NLP du commentaire (déjà rédigé PII). */
  readonly analysis: CommentAnalysis;
}

/** Contribution décomposée au score (LA LOI `QualityScoreComponent`). */
export interface ScoreComponent {
  /** Dimension (ex. "structured", "sentiment"). */
  readonly key: string;
  /** Contribution à l'échelle du score. */
  readonly value: number;
}

/** Fréquence d'un thème sur la population de feedbacks analysés. */
export interface ThemeFrequency {
  /** Thème (enum fermé). */
  readonly theme: FeedbackTheme;
  /** Fréquence relative [0, 1]. */
  readonly frequency: number;
  /** Sentiment dominant associé au thème. */
  readonly sentiment: SentimentLabel;
}

/** Résultat de scoring pour un scope (agence ou agent). */
export interface QualityScoreResult {
  /** Score sur {@link QUALITY_SCALE}, ou `null` si non publié (échantillon faible). */
  readonly score: number | null;
  /** Échelle du score. */
  readonly scale: number;
  /** Nombre de feedbacks analysés (FR/EN, hors `unsupported`). */
  readonly sampleSize: number;
  /** `true` si sous le seuil de publication ⇒ score non publié. */
  readonly insufficientSample: boolean;
  /** Décomposition explicable (jamais de sanction auto — usage advisory). */
  readonly components: readonly ScoreComponent[];
}

/** Répartition des sentiments en pourcentages (LA LOI `SentimentBreakdown`). */
export interface SentimentBreakdown {
  readonly positive: number;
  readonly neutral: number;
  readonly negative: number;
}

/** Arrondi à 1 décimale. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Arrondi à 2 décimales. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ne conserve que les feedbacks analysables (FR/EN, non exclus). Les `unsupported`
 * sont écartés du scoring (jamais de classification hasardeuse).
 */
export function analyzableFeedbacks(feedbacks: readonly AnalyzedFeedback[]): AnalyzedFeedback[] {
  return feedbacks.filter((f) => !f.analysis.excluded);
}

/**
 * Calcule le score qualité d'un scope à partir de ses feedbacks analysés.
 *
 * Score = w_s · (note moyenne) + w_sent · (sentiment moyen remis sur l'échelle).
 * Le sentiment continu [-1, 1] est mappé linéairement sur [1, {@link QUALITY_SCALE}].
 * Sous le seuil d'échantillon, `score` est `null` et `insufficientSample: true`.
 *
 * @param feedbacks - Feedbacks du scope (les `unsupported` sont ignorés).
 * @returns Résultat décomposé, publiable ou non.
 */
export function computeQualityScore(
  feedbacks: readonly AnalyzedFeedback[]
): QualityScoreResult {
  const usable = analyzableFeedbacks(feedbacks);
  const sampleSize = usable.length;
  const insufficient = sampleSize < MIN_SAMPLE_SIZE;

  // Contribution note structurée : moyenne des ratings présents, sinon neutre (3).
  const ratings = usable.map((f) => f.rating).filter((r): r is number => r !== null);
  const avgRating = ratings.length > 0
    ? ratings.reduce((a, b) => a + b, 0) / ratings.length
    : QUALITY_SCALE / 2 + 0.5; // 3.0 sur échelle 5 = neutre

  // Contribution sentiment : moyenne des scores continus, mappée [-1,1]→[1,scale].
  const avgSentiment = sampleSize > 0
    ? usable.reduce((a, f) => a + f.analysis.sentimentScore, 0) / sampleSize
    : 0;
  const sentimentOnScale = 1 + ((avgSentiment + 1) / 2) * (QUALITY_SCALE - 1);

  const structuredContribution = STRUCTURED_WEIGHT * avgRating;
  const sentimentContribution = SENTIMENT_WEIGHT * sentimentOnScale;
  const rawScore = structuredContribution + sentimentContribution;
  const score = Math.max(1, Math.min(QUALITY_SCALE, rawScore));

  const components: ScoreComponent[] = [
    { key: "structured", value: round2(structuredContribution) },
    { key: "sentiment", value: round2(sentimentContribution) },
  ];

  return {
    score: insufficient ? null : round1(score),
    scale: QUALITY_SCALE,
    sampleSize,
    insufficientSample: insufficient,
    components,
  };
}

/**
 * Répartition des sentiments (%) sur les feedbacks analysables.
 *
 * @param feedbacks - Feedbacks du scope.
 * @returns Pourcentages positif/neutre/négatif (somme ≈ 100, ou 0/0/0 si vide).
 */
export function computeSentimentBreakdown(
  feedbacks: readonly AnalyzedFeedback[]
): SentimentBreakdown {
  const usable = analyzableFeedbacks(feedbacks);
  const n = usable.length;
  if (n === 0) return { positive: 0, neutral: 0, negative: 0 };
  const counts: Record<SentimentLabel, number> = { positive: 0, neutral: 0, negative: 0 };
  for (const f of usable) counts[f.analysis.sentiment] += 1;
  return {
    positive: round1((counts.positive / n) * 100),
    neutral: round1((counts.neutral / n) * 100),
    negative: round1((counts.negative / n) * 100),
  };
}

/**
 * Fréquence des thèmes récurrents avec leur sentiment dominant.
 *
 * @param feedbacks - Feedbacks du scope.
 * @param topN       - Nombre maximum de thèmes retournés (défaut : tous).
 * @returns Thèmes triés par fréquence décroissante.
 */
export function computeRecurrentThemes(
  feedbacks: readonly AnalyzedFeedback[],
  topN?: number
): ThemeFrequency[] {
  const usable = analyzableFeedbacks(feedbacks);
  const n = usable.length;
  if (n === 0) return [];
  const themeCount = new Map<FeedbackTheme, number>();
  const themeSentiment = new Map<FeedbackTheme, Record<SentimentLabel, number>>();
  for (const f of usable) {
    for (const theme of f.analysis.themes) {
      themeCount.set(theme, (themeCount.get(theme) ?? 0) + 1);
      const s = themeSentiment.get(theme) ?? { positive: 0, neutral: 0, negative: 0 };
      s[f.analysis.sentiment] += 1;
      themeSentiment.set(theme, s);
    }
  }
  const result: ThemeFrequency[] = [];
  for (const [theme, count] of themeCount) {
    const s = themeSentiment.get(theme)!;
    result.push({
      theme,
      frequency: round2(count / n),
      sentiment: dominantSentiment(s),
    });
  }
  result.sort((a, b) => b.frequency - a.frequency || a.theme.localeCompare(b.theme));
  return topN === undefined ? result : result.slice(0, topN);
}

/** Sentiment dominant d'une distribution (départage stable positive>neutral>negative). */
function dominantSentiment(s: Record<SentimentLabel, number>): SentimentLabel {
  const order: SentimentLabel[] = ["positive", "neutral", "negative"];
  let best: SentimentLabel = "neutral";
  let bestCount = -1;
  for (const label of order) {
    if (s[label] > bestCount) {
      best = label;
      bestCount = s[label];
    }
  }
  return best;
}
