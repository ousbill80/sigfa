/**
 * IA-002 — Backtest du modèle de forecast (fonctions PURES).
 *
 * ## Métriques d'évaluation (EARS IA-002)
 * Sur un jeu de points `{ actual, predicted, confidence }` :
 *  - **MAE**  : erreur absolue moyenne `mean(|actual − predicted|)` ;
 *  - **MAPE** : erreur absolue moyenne en pourcentage, en n'incluant QUE les points
 *    où `actual > 0` (division par zéro exclue) ;
 *  - **calibration** : couverture empirique — proportion de points dont l'erreur
 *    relative est dans la « bande de confiance » attendue `(1 − confidence)`. Une
 *    confiance bien calibrée ⇒ couverture ≈ niveau de confiance moyen.
 *
 * ## Garde-fou de NON-RÉGRESSION vs baseline naïve
 * On compare le MAE du modèle candidat à celui de la **baseline naïve** (moyenne du
 * même bucket J-7 / 4 semaines — `arrivalsRollMean4w`/`arrivalsLag7d` d'IA-001). Le
 * candidat n'est **promu** que s'il bat la baseline avec une marge :
 * `MAE_candidat < MAE_baseline × (1 − marge)` (marge défaut 0,05, D3). Sinon
 * `promoted = false` : le modèle n'est PAS promu (aucun déploiement silencieux).
 *
 * Fonctions PURES, déterministes, zéro I/O.
 *
 * @module
 */

/** Marge de non-régression par défaut : le candidat doit battre la baseline de 5 %. */
export const DEFAULT_NON_REGRESSION_MARGIN = 0.05 as const;

/** Un point d'évaluation du backtest (réel vs prédit, avec confiance). */
export interface BacktestPoint {
  /** Valeur réelle observée (tickets). */
  readonly actual: number;
  /** Valeur prédite par le modèle candidat. */
  readonly predicted: number;
  /** Prédiction de la baseline naïve pour le même point. */
  readonly baseline: number;
  /** Confiance annoncée par le candidat pour ce point (0..1). */
  readonly confidence: number;
}

/** Métriques d'erreur d'un jeu de prédictions. */
export interface ErrorMetrics {
  /** Erreur absolue moyenne. */
  readonly mae: number;
  /** Erreur absolue moyenne en pourcentage (points `actual > 0` uniquement). */
  readonly mape: number;
  /** Nombre de points évalués. */
  readonly n: number;
}

/** Résultat complet du backtest (candidat vs baseline + calibration + verdict). */
export interface BacktestResult {
  /** Métriques du modèle candidat. */
  readonly candidate: ErrorMetrics;
  /** Métriques de la baseline naïve. */
  readonly baseline: ErrorMetrics;
  /** Couverture empirique de l'intervalle de confiance (0..1). */
  readonly calibrationCoverage: number;
  /** Confiance moyenne annoncée (0..1) — comparateur de calibration. */
  readonly meanConfidence: number;
  /** Marge de non-régression exigée. */
  readonly margin: number;
  /**
   * `true` si `MAE_candidat < MAE_baseline × (1 − margin)` — le candidat bat la
   * baseline et peut être promu. Sinon `false` (non promu).
   */
  readonly promoted: boolean;
}

/** Moyenne d'un tableau non vide ; 0 si vide. */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * Calcule MAE/MAPE d'un jeu `{ actual, predicted }`.
 *
 * @param points   - Points d'évaluation
 * @param selector - Sélecteur de la prédiction à évaluer (`candidate` ou `baseline`)
 */
export function computeErrorMetrics(
  points: readonly BacktestPoint[],
  selector: (p: BacktestPoint) => number
): ErrorMetrics {
  if (points.length === 0) return { mae: 0, mape: 0, n: 0 };
  const absErrors = points.map((p) => Math.abs(p.actual - selector(p)));
  const pctErrors = points
    .filter((p) => p.actual > 0)
    .map((p) => Math.abs(p.actual - selector(p)) / p.actual);
  return {
    mae: mean(absErrors),
    mape: pctErrors.length > 0 ? mean(pctErrors) * 100 : 0,
    n: points.length,
  };
}

/**
 * Couverture empirique de calibration : proportion de points dont l'erreur relative
 * `|actual − predicted| / max(actual, 1)` est **inférieure ou égale** à la marge
 * tolérée `(1 − confidence)`. Un modèle bien calibré ⇒ couverture ≈ confiance
 * moyenne annoncée.
 *
 * @param points - Points d'évaluation
 */
export function computeCalibrationCoverage(points: readonly BacktestPoint[]): number {
  if (points.length === 0) return 0;
  let covered = 0;
  for (const p of points) {
    const denom = Math.max(p.actual, 1);
    const relError = Math.abs(p.actual - p.predicted) / denom;
    const tolerance = 1 - p.confidence;
    if (relError <= tolerance) covered += 1;
  }
  return covered / points.length;
}

/**
 * Exécute le backtest complet : métriques candidat & baseline, calibration, et
 * verdict de non-régression (promotion).
 *
 * @param points - Points d'évaluation `{ actual, predicted, baseline, confidence }`
 * @param margin - Marge de non-régression (défaut 0,05 — battre la baseline de 5 %)
 */
export function runBacktest(
  points: readonly BacktestPoint[],
  margin: number = DEFAULT_NON_REGRESSION_MARGIN
): BacktestResult {
  const candidate = computeErrorMetrics(points, (p) => p.predicted);
  const baseline = computeErrorMetrics(points, (p) => p.baseline);
  const calibrationCoverage = computeCalibrationCoverage(points);
  const meanConfidence = mean(points.map((p) => p.confidence));

  // Non-régression : le candidat doit battre la baseline avec la marge exigée.
  // Si la baseline est parfaite (MAE 0), le candidat doit l'égaler pour être promu.
  const promoted =
    baseline.mae === 0
      ? candidate.mae === 0
      : candidate.mae < baseline.mae * (1 - margin);

  return {
    candidate,
    baseline,
    calibrationCoverage,
    meanConfidence,
    margin,
    promoted,
  };
}
