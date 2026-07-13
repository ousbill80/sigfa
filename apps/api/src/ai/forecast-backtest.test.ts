/**
 * IA-002 — Tests du backtest (MAE/MAPE + calibration + non-régression vs baseline).
 *
 * Couvre les critères ⊛ :
 *  - MAE/MAPE + calibration confidence calculés sur jeu synthétique ;
 *  - garde-fou non-régression : candidat bat la baseline naïve, sinon NON promu ;
 *  - intégration : le modèle IA-002 bat la baseline sur un jeu à signal calendaire.
 *
 * Nommage strict : `IA-002: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  computeErrorMetrics,
  computeCalibrationCoverage,
  runBacktest,
  DEFAULT_NON_REGRESSION_MARGIN,
  type BacktestPoint,
} from "src/ai/forecast-backtest.js";
import { predictBucket, baselineExpected } from "src/ai/forecast-model.js";
import { makeFeature } from "src/ai/forecast-fixtures.js";

describe("forecast-backtest", () => {
  it("IA-002: MAE calculé correctement (moyenne des erreurs absolues)", () => {
    const points: BacktestPoint[] = [
      { actual: 10, predicted: 12, baseline: 15, confidence: 0.9 },
      { actual: 20, predicted: 18, baseline: 25, confidence: 0.9 },
    ];
    // |10-12| + |20-18| = 2 + 2 → MAE = 2
    const m = computeErrorMetrics(points, (p) => p.predicted);
    expect(m.mae).toBe(2);
    expect(m.n).toBe(2);
  });

  it("IA-002: MAPE ignore les points actual=0 (pas de division par zéro)", () => {
    const points: BacktestPoint[] = [
      { actual: 0, predicted: 5, baseline: 5, confidence: 0.9 },
      { actual: 10, predicted: 8, baseline: 10, confidence: 0.9 },
    ];
    // seul le 2e point compte : |10-8|/10 = 0.2 → MAPE = 20 %
    const m = computeErrorMetrics(points, (p) => p.predicted);
    expect(m.mape).toBeCloseTo(20, 5);
  });

  it("IA-002: MAPE = 0 si aucun point actual>0", () => {
    const points: BacktestPoint[] = [
      { actual: 0, predicted: 3, baseline: 3, confidence: 0.5 },
    ];
    expect(computeErrorMetrics(points, (p) => p.predicted).mape).toBe(0);
  });

  it("IA-002: métriques d'un jeu vide sont neutres (0)", () => {
    const m = computeErrorMetrics([], (p) => p.predicted);
    expect(m).toEqual({ mae: 0, mape: 0, n: 0 });
    expect(computeCalibrationCoverage([])).toBe(0);
  });

  it("IA-002: calibration — couverture élevée quand erreur relative sous la tolérance (1 - confidence)", () => {
    // confidence 0.9 → tolérance 0.1 ; erreur relative |10-10.5|/10 = 0.05 ≤ 0.1 → couvert
    const points: BacktestPoint[] = [
      { actual: 10, predicted: 10.5, baseline: 20, confidence: 0.9 },
      { actual: 40, predicted: 41, baseline: 20, confidence: 0.9 },
    ];
    expect(computeCalibrationCoverage(points)).toBe(1);
  });

  it("IA-002: calibration — point hors bande n'est pas couvert", () => {
    // confidence 0.9 → tolérance 0.1 ; erreur relative |10-20|/10 = 1.0 > 0.1 → non couvert
    const points: BacktestPoint[] = [
      { actual: 10, predicted: 20, baseline: 10, confidence: 0.9 },
    ];
    expect(computeCalibrationCoverage(points)).toBe(0);
  });

  it("IA-002: garde-fou non-régression — candidat PROMU s'il bat la baseline au-delà de la marge", () => {
    const points: BacktestPoint[] = [
      { actual: 10, predicted: 10, baseline: 20, confidence: 0.9 },
      { actual: 30, predicted: 30, baseline: 15, confidence: 0.9 },
    ];
    const res = runBacktest(points);
    expect(res.candidate.mae).toBe(0);
    expect(res.baseline.mae).toBeGreaterThan(0);
    expect(res.promoted).toBe(true);
    expect(res.margin).toBe(DEFAULT_NON_REGRESSION_MARGIN);
  });

  it("IA-002: garde-fou non-régression — candidat NON promu s'il n'améliore pas assez la baseline", () => {
    // candidat MAE 10, baseline MAE 10 → pas d'amélioration → non promu.
    const points: BacktestPoint[] = [
      { actual: 0, predicted: 10, baseline: 10, confidence: 0.5 },
      { actual: 20, predicted: 10, baseline: 10, confidence: 0.5 },
    ];
    const res = runBacktest(points);
    expect(res.candidate.mae).toBe(res.baseline.mae);
    expect(res.promoted).toBe(false);
  });

  it("IA-002: baseline parfaite (MAE 0) → candidat promu seulement s'il l'égale", () => {
    const perfect: BacktestPoint[] = [
      { actual: 10, predicted: 10, baseline: 10, confidence: 0.9 },
    ];
    expect(runBacktest(perfect).promoted).toBe(true);
    const worse: BacktestPoint[] = [
      { actual: 10, predicted: 12, baseline: 10, confidence: 0.9 },
    ];
    expect(runBacktest(worse).promoted).toBe(false);
  });

  it("IA-002: intégration — le modèle IA-002 bat la baseline naïve sur un jeu à signal calendaire", () => {
    // Vérité terrain : les jours de paie ont ~40 % d'affluence en plus vs la moyenne.
    // La baseline naïve prédit la moyenne (rollMean4w) ; le modèle applique le
    // multiplicateur paie → doit se rapprocher de la vérité.
    const baseArrivals = 20;
    const payDayActual = 28; // = 20 * 1.4
    const points: BacktestPoint[] = [];
    for (let i = 0; i < 10; i += 1) {
      const feat = makeFeature({
        arrivalsRollMean4w: baseArrivals,
        arrivalsLag7d: baseArrivals,
        isPublicPayDay: true,
      });
      const predicted = predictBucket(feat).expectedTickets;
      const baseline = baselineExpected(feat);
      points.push({ actual: payDayActual, predicted, baseline, confidence: predictBucket(feat).confidence });
    }
    const res = runBacktest(points);
    expect(res.candidate.mae).toBeLessThan(res.baseline.mae);
    expect(res.promoted).toBe(true);
  });
});
