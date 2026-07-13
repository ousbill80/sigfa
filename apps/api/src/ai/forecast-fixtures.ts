/**
 * IA-002 — Fabriques de features synthétiques pour les tests de forecast/staffing/backtest.
 *
 * Construit des `FeatureRecord` déterministes (IA-001) sans conteneur ni I/O, de
 * façon à backtester le modèle AVANT toute donnée réelle (critères ⊛ IA-002).
 *
 * @module
 */

import type { ContextualFactor } from "src/ai/ci-calendar.js";
import type { FeatureRecord } from "src/ai/feature-engine.js";
import { FEATURE_SET_VERSION } from "src/ai/feature-engine.js";

/** Banque de test (UUID valide). */
export const FX_BANK = "11111111-1111-4111-8111-111111111111";
/** Agence de test (UUID valide). */
export const FX_AGENCY = "33333333-3333-4333-a333-333333333333";

/** Surcharges possibles d'un `FeatureRecord` synthétique. */
export interface FeatureOverrides {
  readonly bankId?: string;
  readonly agencyId?: string;
  readonly date?: string;
  readonly hourBucket?: number;
  readonly arrivals?: number;
  readonly arrivalsLag7d?: number | null;
  readonly arrivalsRollMean4w?: number | null;
  readonly isMonthEnd?: boolean;
  readonly isPublicPayDay?: boolean;
  readonly isPublicHoliday?: boolean;
  readonly isEveOfHoliday?: boolean;
  readonly factors?: readonly ContextualFactor[];
  readonly isPartial?: boolean;
  readonly availableDays?: number;
}

/**
 * Construit un `FeatureRecord` synthétique complet à partir de surcharges.
 * Valeurs par défaut : bucket 60 min complet, historique dense, aucun facteur.
 */
export function makeFeature(o: FeatureOverrides = {}): FeatureRecord {
  const arrivals = o.arrivals ?? 20;
  const factors = o.factors ?? ["NONE"];
  return {
    bankId: o.bankId ?? FX_BANK,
    agencyId: o.agencyId ?? FX_AGENCY,
    serviceId: null,
    date: o.date ?? "2026-07-15",
    hourBucket: o.hourBucket ?? 9,
    bucketMinutes: 60,
    arrivals,
    served: arrivals,
    noShow: 0,
    abandoned: 0,
    avgWaitSeconds: 120,
    p90WaitSeconds: 200,
    avgServiceSeconds: 300,
    countersOpen: 2,
    agentsActive: 2,
    dayOfWeek: 3,
    isMonthEnd: o.isMonthEnd ?? false,
    isPublicPayDay: o.isPublicPayDay ?? false,
    isPublicHoliday: o.isPublicHoliday ?? false,
    isEveOfHoliday: o.isEveOfHoliday ?? false,
    factors,
    arrivalsLag1d: null,
    arrivalsLag7d: o.arrivalsLag7d === undefined ? arrivals : o.arrivalsLag7d,
    arrivalsRollMean4w:
      o.arrivalsRollMean4w === undefined ? arrivals : o.arrivalsRollMean4w,
    isPartial: o.isPartial ?? false,
    availableDays: o.availableDays ?? 120,
    featureSetVersion: FEATURE_SET_VERSION,
  };
}

/**
 * Construit une journée de buckets horaires (heures données) pour une agence/date.
 *
 * @param date    - Jour cible
 * @param buckets - Liste `{ hour, arrivals }` (rollMean4w = arrivals par défaut)
 * @param common  - Surcharges communes à tous les buckets (facteurs calendaires…)
 */
export function makeDay(
  date: string,
  buckets: readonly { hour: number; roll: number | null }[],
  common: FeatureOverrides = {}
): FeatureRecord[] {
  return buckets.map((b) =>
    makeFeature({
      ...common,
      date,
      hourBucket: b.hour,
      arrivals: b.roll ?? 0,
      arrivalsLag7d: b.roll,
      arrivalsRollMean4w: b.roll,
    })
  );
}
