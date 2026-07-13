/**
 * IA-004 — Tests du backtest NLP sur corpus FR/EN annoté (métriques + biais).
 *
 * Couvre les critères ⊛ : précision/rappel/F1 sentiment+thèmes + matrice de
 * confusion sur corpus FR/EN étiqueté ; parité de performance FR vs EN dans la
 * tolérance (anti-biais).
 *
 * Nommage strict : `IA-004: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  runBacktest,
  evaluate,
  ANNOTATED_CORPUS,
  PARITY_TOLERANCE,
} from "src/ai/feedback-backtest.js";

describe("feedback-backtest — métriques d'évaluation", () => {
  const report = runBacktest();

  it("IA-004: précision/rappel/F1 sentiment calculés sur corpus FR/EN", () => {
    expect(report.sentiment.total).toBe(ANNOTATED_CORPUS.length);
    // Le classifieur lexical atteint une bonne exactitude sur ce corpus contrôlé.
    expect(report.sentiment.accuracy).toBeGreaterThanOrEqual(0.85);
    expect(report.sentiment.macroF1).toBeGreaterThanOrEqual(0.7);
    for (const cls of ["positive", "neutral", "negative"]) {
      expect(report.sentiment.perClass[cls]).toBeDefined();
    }
  });

  it("IA-004: précision/rappel/F1 thèmes calculés (enum fermé)", () => {
    expect(report.theme.total).toBe(ANNOTATED_CORPUS.length);
    expect(report.theme.accuracy).toBeGreaterThanOrEqual(0.75);
  });

  it("IA-004: matrice de confusion structurée (réel × prédit)", () => {
    const conf = report.sentiment.confusion;
    // Diagonale = classifications correctes ; la matrice couvre toutes les classes.
    expect(conf["positive"]).toBeDefined();
    expect(conf["negative"]!["negative"]).toBeGreaterThan(0);
  });
});

describe("feedback-backtest — anti-biais FR vs EN", () => {
  const report = runBacktest();

  it(`IA-004: parité de performance FR vs EN (|F1_FR − F1_EN| ≤ ${PARITY_TOLERANCE})`, () => {
    expect(report.parityGap).toBeLessThanOrEqual(PARITY_TOLERANCE);
    expect(report.parityOk).toBe(true);
  });

  it("IA-004: F1 FR et EN tous deux élevés (pas de dérive linguistique)", () => {
    expect(report.f1SentimentFr).toBeGreaterThanOrEqual(0.7);
    expect(report.f1SentimentEn).toBeGreaterThanOrEqual(0.7);
  });
});

describe("feedback-backtest — evaluate (fonction pure)", () => {
  it("IA-004: evaluate calcule précision/rappel/F1 corrects sur un cas connu", () => {
    const pairs = [
      { actual: "a", predicted: "a" },
      { actual: "a", predicted: "b" },
      { actual: "b", predicted: "b" },
      { actual: "b", predicted: "b" },
    ] as const;
    const res = evaluate([...pairs], ["a", "b"]);
    expect(res.accuracy).toBe(0.75);
    // classe a : tp=1, fn=1, fp=0 → precision 1, recall 0.5, f1 ~0.667
    expect(res.perClass["a"]!.precision).toBe(1);
    expect(res.perClass["a"]!.recall).toBe(0.5);
    expect(res.perClass["a"]!.f1).toBeCloseTo(0.667, 2);
  });

  it("IA-004: evaluate sur ensemble vide → métriques nulles sans throw", () => {
    const res = evaluate([], ["a", "b"]);
    expect(res.accuracy).toBe(0);
    expect(res.macroF1).toBe(0);
    expect(res.total).toBe(0);
  });
});
