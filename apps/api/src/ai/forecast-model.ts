/**
 * IA-002 — Modèle de prévision d'affluence horaire (fonctions PURES, interprétables).
 *
 * ## Un modèle simple, interprétable, PAR TENANT
 * Le forecast d'un bucket part de la **baseline naïve** d'IA-001 (moyenne du même
 * bucket sur 4 semaines glissantes `arrivalsRollMean4w`, repli `arrivalsLag7d`),
 * puis applique des **ajustements calendaires multiplicatifs** bornés et explicites
 * (fin de mois, paie fonction publique, férié/veille). Chaque ajustement est tracé
 * dans `drivers[]` (facteur, sens, poids relatif) — AUCUNE boîte noire.
 *
 * Le modèle ne consomme QUE des `FeatureRecord` d'IA-001 (features agrégées, zéro
 * PII) portant un `bankId` unique : l'isolation tenant est garantie en amont par la
 * couche extraction sous `withTenant`. Ce moteur ne lit jamais deux tenants à la
 * fois — il opère sur la liste de features d'UN tenant/agence.
 *
 * ## Confiance interprétable
 * `confidence ∈ [0,1]` reflète la **densité d'historique** du bucket : proportion de
 * points de lag réellement présents (J-7, J-14, J-21, J-28) + pénalité si le bucket
 * source est `isPartial`. `lowConfidence = confidence < seuil` (défaut 0,5,
 * D3 arbitrage) → aucune reco staffing dérivée du seul point faible (garde
 * anti-sur-réaction, appliquée dans `staffing-reco.ts`).
 *
 * ## Pureté & déterminisme
 * Aucune I/O, aucune horloge cachée. Rejouer les mêmes features produit exactement
 * la même prévision (idempotence de calcul, ordonnée par heure croissante).
 *
 * @module
 */

import type { ContextualFactor } from "src/ai/ci-calendar.js";
import type { FeatureRecord } from "src/ai/feature-engine.js";

/** Version du modèle de forecast (estampille `AiMeta.modelVersion`, CONTRACT-008). */
export const FORECAST_MODEL_VERSION = "forecast-ia002-v1" as const;

/** Seuil de confiance faible (D3 arbitrage : `lowConfidence < 0,5`). */
export const LOW_CONFIDENCE_THRESHOLD = 0.5 as const;

/**
 * Poids calendaires multiplicatifs du modèle (interprétables, bornés).
 *
 * Un facteur `> 1` pousse l'affluence à la hausse (`direction: "up"`), `< 1` à la
 * baisse. Le `weight` exposé dans `drivers[]` est l'écart relatif `|mult − 1|`.
 * Valeurs par défaut métier CI (paramétrables par tenant sans changer le moteur).
 */
export interface CalendarWeights {
  /** Multiplicateur fin de mois (3 derniers jours ouvrés). */
  readonly endOfMonth: number;
  /** Multiplicateur fenêtre paie fonction publique. */
  readonly civilServicePay: number;
  /** Multiplicateur veille de férié (rush avant fermeture). */
  readonly eveOfHoliday: number;
  /** Multiplicateur jour férié (agence souvent fermée → forte baisse). */
  readonly publicHoliday: number;
}

/** Poids calendaires par défaut (métier CI, D3). Interprétables et bornés. */
export const DEFAULT_CALENDAR_WEIGHTS: CalendarWeights = {
  endOfMonth: 1.25,
  civilServicePay: 1.4,
  eveOfHoliday: 1.15,
  publicHoliday: 0.1,
};

/** Options du modèle de forecast (poids + seuils, tous injectables/testables). */
export interface ForecastModelOptions {
  /** Poids calendaires (défaut `DEFAULT_CALENDAR_WEIGHTS`). */
  readonly weights?: CalendarWeights;
  /** Seuil `lowConfidence` (défaut `LOW_CONFIDENCE_THRESHOLD`). */
  readonly lowConfidenceThreshold?: number;
}

/** Facteur explicatif d'un point de forecast (CONTRACT-008 `ForecastDriver`). */
export interface ForecastDriver {
  /** Nom du facteur (ex. "CIVIL_SERVICE_PAY", "history_trend"). */
  readonly factor: string;
  /** Sens de contribution. */
  readonly direction: "up" | "down";
  /** Poids relatif (0..1), écart à la médiane/baseline. */
  readonly weight: number;
}

/** Prévision d'un bucket horaire (CONTRACT-008 `ForecastHour` + IA-002 additifs). */
export interface ForecastHour {
  /** Heure `HH:MM` (heure locale Africa/Abidjan). */
  readonly hour: string;
  /** Tickets attendus (entier ≥ 0). */
  readonly expectedTickets: number;
  /** Indice de confiance 0..1. */
  readonly confidence: number;
  /** Facteurs explicatifs (explicabilité obligatoire IA-002). Jamais vide. */
  readonly drivers: readonly ForecastDriver[];
  /** `true` si `confidence < seuil` (garde anti-sur-réaction). */
  readonly lowConfidence: boolean;
}

/** Résultat complet du forecast d'une agence pour une date. */
export interface AgencyForecast {
  /** Agence. */
  readonly agencyId: string;
  /** Date cible `YYYY-MM-DD`. */
  readonly date: string;
  /** Facteurs contextuels de la journée (union des buckets), libellés CONTRACT-008. */
  readonly contextualFactors: readonly ContextualFactor[];
  /** Série horaire triée par heure croissante. */
  readonly forecast: readonly ForecastHour[];
}

/** Nb de points de lag pris en compte pour la densité de confiance (J-7..J-28). */
const LAG_POINTS_MAX = 4 as const;

/** Borne une valeur dans `[0, 1]`. */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Formate un index de bucket horaire (0–23) en `HH:MM`. */
function bucketToHhMm(hourBucket: number, bucketMinutes: number): string {
  const totalMinutes = hourBucket * bucketMinutes;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Baseline naïve d'un bucket : moyenne du même bucket sur 4 semaines glissantes
 * (`arrivalsRollMean4w`), repli sur `arrivalsLag7d`, puis 0 si aucun historique.
 * Miroir EXACT de la baseline de non-régression du backtest (`forecast-backtest`).
 */
export function baselineExpected(r: FeatureRecord): number {
  if (r.arrivalsRollMean4w !== null) return r.arrivalsRollMean4w;
  if (r.arrivalsLag7d !== null) return r.arrivalsLag7d;
  return 0;
}

/**
 * Densité d'historique d'un bucket ∈ [0,1] : proportion de points de lag présents
 * (J-7, J-14, J-21, J-28) approximée par la disponibilité de `rollMean4w`/`lag7d`,
 * avec pénalité si le bucket est partiel. Base interprétable de la confiance.
 */
function historyDensity(r: FeatureRecord): number {
  let present = 0;
  if (r.arrivalsLag7d !== null) present += 1;
  // rollMean4w agrège jusqu'à 4 points ; on l'utilise comme proxy de densité
  // (présent ⇒ au moins un point ≥ J-7). On récompense sa présence.
  if (r.arrivalsRollMean4w !== null) present += LAG_POINTS_MAX - 1;
  const density = present / LAG_POINTS_MAX;
  return r.isPartial ? density * 0.6 : density;
}

/** Applique les ajustements calendaires et collecte les drivers correspondants. */
function applyCalendar(
  base: number,
  r: FeatureRecord,
  w: CalendarWeights
): { adjusted: number; drivers: ForecastDriver[] } {
  const drivers: ForecastDriver[] = [];
  let mult = 1;

  const push = (factor: string, factorMult: number): void => {
    mult *= factorMult;
    drivers.push({
      factor,
      direction: factorMult >= 1 ? "up" : "down",
      weight: clamp01(Math.abs(factorMult - 1)),
    });
  };

  if (r.isPublicHoliday) push("PUBLIC_HOLIDAY", w.publicHoliday);
  if (r.isEveOfHoliday) push("EVE_OF_HOLIDAY", w.eveOfHoliday);
  if (r.isMonthEnd) push("END_OF_MONTH", w.endOfMonth);
  if (r.isPublicPayDay) push("CIVIL_SERVICE_PAY", w.civilServicePay);

  return { adjusted: base * mult, drivers };
}

/**
 * Prédit un bucket horaire à partir de son `FeatureRecord` (baseline + calendrier).
 *
 * @param r    - Feature record du bucket cible (mêmes bankId/agencyId/date)
 * @param opts - Poids & seuils (défaut métier CI)
 */
export function predictBucket(
  r: FeatureRecord,
  opts: ForecastModelOptions = {}
): ForecastHour {
  const w = opts.weights ?? DEFAULT_CALENDAR_WEIGHTS;
  const threshold = opts.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;

  const base = baselineExpected(r);
  const { adjusted, drivers } = applyCalendar(base, r, w);
  const expectedTickets = Math.max(0, Math.round(adjusted));

  const confidence = clamp01(historyDensity(r));

  // Driver « tendance historique » : toujours présent (explicabilité non-vide même
  // sans facteur calendaire). Sens selon que la baseline dépasse ou non la moyenne.
  const trendDrivers: ForecastDriver[] =
    drivers.length > 0
      ? drivers
      : [{ factor: "history_trend", direction: "up", weight: clamp01(confidence) }];

  return {
    hour: bucketToHhMm(r.hourBucket, r.bucketMinutes),
    expectedTickets,
    confidence,
    drivers: trendDrivers,
    lowConfidence: confidence < threshold,
  };
}

/** Déduplique en préservant l'ordre d'apparition (facteurs contextuels). */
function uniqueInOrder<T>(items: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const it of items) {
    if (!seen.has(it)) {
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}

/**
 * Prévoit l'affluence horaire d'une agence pour une date, à partir des features
 * IA-001 de cette date (un `FeatureRecord` par bucket). Fonction PURE.
 *
 * Les records doivent porter le MÊME `agencyId` et la MÊME `date` (features déjà
 * filtrées en amont). L'ordre de sortie est croissant par heure.
 *
 * @param agencyId - Agence cible (repris tel quel)
 * @param date     - Date cible `YYYY-MM-DD`
 * @param records  - Features IA-001 des buckets de la date (un tenant)
 * @param opts     - Poids & seuils du modèle
 */
export function forecastAgencyDay(
  agencyId: string,
  date: string,
  records: readonly FeatureRecord[],
  opts: ForecastModelOptions = {}
): AgencyForecast {
  const dayRecords = records
    .filter((r) => r.agencyId === agencyId && r.date === date)
    .slice()
    .sort((a, b) => a.hourBucket - b.hourBucket);

  const forecast = dayRecords.map((r) => predictBucket(r, opts));

  const factors = uniqueInOrder(dayRecords.flatMap((r) => r.factors));
  const contextualFactors: ContextualFactor[] =
    factors.length > 0 ? factors : ["NONE"];

  return { agencyId, date, contextualFactors, forecast };
}
