/**
 * IA-003 — Backtest des détecteurs sur scénarios synthétiques étiquetés.
 *
 * ⊛ Entièrement évaluable AVANT données réelles (le taux de faux positifs sur
 * trafic pilote réel reste, lui, GATED — hors CI).
 *
 * Ce module est PUR : il rejoue un jeu de scénarios ÉTIQUETÉS (chaque scénario
 * porte les faits SIGFA d'entrée + les types d'anomalies attendus) à travers les
 * détecteurs (`anomaly-detectors.ts`), puis calcule **précision / rappel / F1**
 * par type d'anomalie. Un scénario « nominal » (aucun label) qui produirait une
 * anomalie compte comme faux positif — c'est le garde-fou anti-bruit.
 *
 * Aucune I/O, aucune persistance, ZÉRO action corrective : le backtest MESURE.
 *
 * @module
 */

import {
  detectQueueStuck,
  detectAgentInactivePattern,
  detectSlaSystemic,
  resolveThresholds,
  ANOMALY_TYPES,
  type AnomalyType,
  type QueueStateObservation,
  type AgentInactiveAlertRecord,
  type DailySlaRecord,
  type ThresholdOverrides,
} from "src/ai/anomaly-detectors.js";

/** Faits SIGFA d'entrée d'un scénario (mêlant les 3 sources de détection). */
export interface ScenarioInputs {
  /** États de files (QUEUE_STUCK). */
  readonly queueStates?: readonly QueueStateObservation[];
  /** Alertes agrégées AGENT_INACTIVE (AGENT_INACTIVE_PATTERN). */
  readonly inactiveAlerts?: readonly AgentInactiveAlertRecord[];
  /** Taux SLA journaliers (SLA_SYSTEMIC). */
  readonly dailySla?: readonly DailySlaRecord[];
  /** Fin de fenêtre glissante pour AGENT_INACTIVE_PATTERN (`YYYY-MM-DD`). */
  readonly windowEndDate?: string;
  /** Surcharge de seuils banque (CONTRACT-005), optionnelle. */
  readonly thresholds?: ThresholdOverrides;
}

/** Scénario synthétique ÉTIQUETÉ : faits + vérité terrain (types attendus). */
export interface LabeledScenario {
  /** Identifiant lisible du scénario. */
  readonly id: string;
  /** Faits SIGFA d'entrée. */
  readonly inputs: ScenarioInputs;
  /**
   * Types d'anomalies ATTENDUS (vérité terrain). Vide = scénario nominal :
   * le détecteur ne doit lever AUCUNE anomalie.
   */
  readonly expected: readonly AnomalyType[];
}

/** Métriques d'évaluation pour un type d'anomalie. */
export interface TypeMetrics {
  readonly type: AnomalyType;
  /** Vrais positifs. */
  readonly tp: number;
  /** Faux positifs. */
  readonly fp: number;
  /** Faux négatifs. */
  readonly fn: number;
  /** Précision `tp / (tp + fp)` — 1 si aucun positif prédit. */
  readonly precision: number;
  /** Rappel `tp / (tp + fn)` — 1 si aucun positif attendu. */
  readonly recall: number;
  /** F1 `2·P·R / (P + R)` — 0 si P+R = 0. */
  readonly f1: number;
}

/** Résultat global du backtest (par type + agrégat). */
export interface BacktestResult {
  readonly perType: Record<AnomalyType, TypeMetrics>;
  /** Nombre de scénarios nominaux ayant produit ≥1 anomalie (doit être 0). */
  readonly nominalFalsePositives: number;
}

/**
 * Exécute TOUS les détecteurs sur un scénario et renvoie l'ensemble des types
 * d'anomalies DÉTECTÉS (dédupliqué). Fonction PURE.
 *
 * @param inputs - Faits SIGFA du scénario
 * @returns Ensemble des types détectés
 */
export function detectAll(inputs: ScenarioInputs): Set<AnomalyType> {
  const thresholds = resolveThresholds(inputs.thresholds);
  const detected = new Set<AnomalyType>();

  for (const c of detectQueueStuck(inputs.queueStates ?? [], thresholds)) {
    detected.add(c.type);
  }
  if (inputs.windowEndDate) {
    for (const c of detectAgentInactivePattern(
      inputs.inactiveAlerts ?? [],
      inputs.windowEndDate,
      thresholds
    )) {
      detected.add(c.type);
    }
  }
  for (const c of detectSlaSystemic(inputs.dailySla ?? [], thresholds)) {
    detected.add(c.type);
  }
  return detected;
}

/** Divise en gérant le dénominateur nul (convention : 1 si rien à prédire/trouver). */
function ratioOrOne(num: number, den: number): number {
  return den === 0 ? 1 : num / den;
}

/**
 * Calcule les métriques précision/rappel/F1 par type sur un jeu de scénarios
 * étiquetés, et compte les faux positifs des scénarios nominaux.
 *
 * @param scenarios - Scénarios synthétiques étiquetés
 * @returns Métriques par type + faux positifs nominaux
 */
export function backtest(scenarios: readonly LabeledScenario[]): BacktestResult {
  /** Initialise un compteur à 0 pour CHAQUE type (accès indexé garanti non-undefined). */
  const zeroed = (): Record<AnomalyType, number> => {
    const acc = {} as Record<AnomalyType, number>;
    for (const t of ANOMALY_TYPES) acc[t] = 0;
    return acc;
  };
  const tp = zeroed();
  const fp = zeroed();
  const fn = zeroed();

  let nominalFalsePositives = 0;

  for (const s of scenarios) {
    const detected = detectAll(s.inputs);
    const expected = new Set(s.expected);

    for (const t of ANOMALY_TYPES) {
      const isExpected = expected.has(t);
      const isDetected = detected.has(t);
      if (isExpected && isDetected) tp[t] += 1;
      else if (!isExpected && isDetected) fp[t] += 1;
      else if (isExpected && !isDetected) fn[t] += 1;
    }

    if (expected.size === 0 && detected.size > 0) nominalFalsePositives += 1;
  }

  const perType = {} as Record<AnomalyType, TypeMetrics>;
  for (const t of ANOMALY_TYPES) {
    const precision = ratioOrOne(tp[t], tp[t] + fp[t]);
    const recall = ratioOrOne(tp[t], tp[t] + fn[t]);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perType[t] = {
      type: t,
      tp: tp[t],
      fp: fp[t],
      fn: fn[t],
      precision,
      recall,
      f1,
    };
  }

  return { perType, nominalFalsePositives };
}
