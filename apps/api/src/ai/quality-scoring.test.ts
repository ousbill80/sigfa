/**
 * IA-004 — Tests unitaires du scoring qualité (INSUFFICIENT_SAMPLE, explicabilité,
 * décomposition, pas de sanction auto).
 *
 * Couvre les critères ⊛ : volume < seuil → INSUFFICIENT_SAMPLE (score non publié) ;
 * score décomposable ; sentiment breakdown ; thèmes récurrents ; aucune mutation.
 *
 * Nommage strict : `IA-004: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  computeQualityScore,
  computeSentimentBreakdown,
  computeRecurrentThemes,
  MIN_SAMPLE_SIZE,
  QUALITY_SCALE,
  type AnalyzedFeedback,
} from "src/ai/quality-scoring.js";
import type { CommentAnalysis } from "src/ai/feedback-nlp.js";

/** Fabrique une analyse NLP simple (helper de test). */
function analysis(
  sentiment: CommentAnalysis["sentiment"],
  score: number,
  themes: CommentAnalysis["themes"] = [],
  excluded = false
): CommentAnalysis {
  return {
    language: "fr",
    sentiment,
    sentimentScore: score,
    themes,
    excluded,
  };
}

/** Fabrique un feedback analysé. */
function fb(rating: number | null, a: CommentAnalysis): AnalyzedFeedback {
  return { rating, analysis: a };
}

/** Génère n feedbacks positifs identiques. */
function manyPositive(n: number): AnalyzedFeedback[] {
  return Array.from({ length: n }, () => fb(5, analysis("positive", 0.8, ["SERVICE_QUALITY"])));
}

describe("quality-scoring — INSUFFICIENT_SAMPLE", () => {
  it(`IA-004: volume < ${MIN_SAMPLE_SIZE} → INSUFFICIENT_SAMPLE, score NON publié (null)`, () => {
    const result = computeQualityScore(manyPositive(MIN_SAMPLE_SIZE - 1));
    expect(result.insufficientSample).toBe(true);
    expect(result.score).toBeNull();
    expect(result.sampleSize).toBe(MIN_SAMPLE_SIZE - 1);
  });

  it(`IA-004: volume ≥ ${MIN_SAMPLE_SIZE} → score publié`, () => {
    const result = computeQualityScore(manyPositive(MIN_SAMPLE_SIZE));
    expect(result.insufficientSample).toBe(false);
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThan(0);
    expect(result.score!).toBeLessThanOrEqual(QUALITY_SCALE);
  });

  it("IA-004: les feedbacks unsupported sont exclus du volume (échantillon)", () => {
    const usable = manyPositive(MIN_SAMPLE_SIZE);
    const excluded = Array.from({ length: 10 }, () =>
      fb(null, analysis("neutral", 0, [], true))
    );
    const result = computeQualityScore([...usable, ...excluded]);
    expect(result.sampleSize).toBe(MIN_SAMPLE_SIZE);
    expect(result.insufficientSample).toBe(false);
  });
});

describe("quality-scoring — explicabilité / décomposition", () => {
  it("IA-004: score décomposable (contribution structurée vs sentiment)", () => {
    const result = computeQualityScore(manyPositive(MIN_SAMPLE_SIZE));
    const keys = result.components.map((c) => c.key);
    expect(keys).toContain("structured");
    expect(keys).toContain("sentiment");
    // La somme des contributions reconstitue (approximativement) le score.
    const sum = result.components.reduce((a, c) => a + c.value, 0);
    expect(Math.abs(sum - result.score!)).toBeLessThan(0.2);
  });

  it("IA-004: sentiment négatif tire le score vers le bas", () => {
    const neg = Array.from({ length: MIN_SAMPLE_SIZE }, () =>
      fb(2, analysis("negative", -0.8, ["WAIT_TIME"]))
    );
    const pos = manyPositive(MIN_SAMPLE_SIZE);
    expect(computeQualityScore(neg).score!).toBeLessThan(computeQualityScore(pos).score!);
  });
});

describe("quality-scoring — sentiment breakdown & thèmes", () => {
  it("IA-004: répartition des sentiments en pourcentages (~100)", () => {
    const feedbacks = [
      fb(5, analysis("positive", 0.8)),
      fb(3, analysis("neutral", 0)),
      fb(1, analysis("negative", -0.8)),
    ];
    const b = computeSentimentBreakdown(feedbacks);
    expect(Math.round(b.positive + b.neutral + b.negative)).toBe(100);
  });

  it("IA-004: thèmes récurrents triés par fréquence, enum fermé", () => {
    const feedbacks = [
      fb(2, analysis("negative", -0.6, ["WAIT_TIME"])),
      fb(2, analysis("negative", -0.6, ["WAIT_TIME"])),
      fb(4, analysis("positive", 0.6, ["STAFF_ATTITUDE"])),
    ];
    const themes = computeRecurrentThemes(feedbacks);
    expect(themes[0]!.theme).toBe("WAIT_TIME");
    expect(themes[0]!.frequency).toBeGreaterThan(themes[1]!.frequency);
    expect(themes[0]!.sentiment).toBe("negative");
  });

  it("IA-004: lot vide → breakdown 0/0/0 et thèmes []", () => {
    expect(computeSentimentBreakdown([])).toEqual({ positive: 0, neutral: 0, negative: 0 });
    expect(computeRecurrentThemes([])).toEqual([]);
  });
});

describe("quality-scoring — garde-fou pas de décision auto", () => {
  it("IA-004: computeQualityScore est PUR (aucune mutation, entrée immuable)", () => {
    const input = manyPositive(MIN_SAMPLE_SIZE);
    const snapshot = JSON.stringify(input);
    computeQualityScore(input);
    // L'entrée n'est pas mutée : aucune action/écriture n'est déclenchée.
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
