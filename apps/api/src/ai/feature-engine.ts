/**
 * IA-001 — Moteur de features d'affluence (fonctions PURES, déterministes).
 *
 * À partir d'une série d'observations horaires brutes (`RawBucketObservation`,
 * extraites des faits SIGFA du tenant — voir `feature-extraction.ts`) et d'un jeu
 * de jours fériés injecté (seed DB-003), produit un `FeatureRecord` par clé
 * canonique `(bankId, agencyId, serviceId?, date, hourBucket)` avec :
 *  - mesures de bucket réutilisées TELLES QUELLES depuis REP-001 (jamais
 *    recalculées « à la main ») ;
 *  - features calendaires (`ci-calendar.ts`) ;
 *  - features LAG : `arrivalsLag1d` (même bucket J-1), `arrivalsLag7d`
 *    (même bucket J-7), `arrivalsRollMean4w` (moyenne du même bucket sur 4
 *    semaines glissantes = J-7, J-14, J-21, J-28) ;
 *  - `isPartial` : bucket incomplet → jamais d'imputation ;
 *  - `availableDays` : nb de jours civils distincts observés pour l'agence (base
 *    du seuil 90 j / `INSUFFICIENT_HISTORY` CONTRACT-008) ;
 *  - `featureSetVersion` : version du schéma de features.
 *
 * ## Pureté & déterminisme
 * Aucune I/O, aucune horloge cachée. L'horloge (`now`) est INJECTÉE pour le calcul
 * de `isPartial` (jour figé J+2 07:00 Abidjan, aligné REP-001). Rejouer la même
 * entrée produit exactement la même sortie (idempotence de calcul).
 *
 * ## Zéro PII
 * Les observations ne portent que des agrégats numériques/calendaires. Aucun
 * identifiant client, aucun numéro, aucun verbatim.
 *
 * @module
 */

import { isDayPartial } from "src/reporting/sla-engine.js";
import {
  calendarFlags,
  previousDay,
  DEFAULT_PAY_DAY_CONFIG,
  type CalendarFlags,
  type ContextualFactor,
  type PayDayConfig,
} from "src/ai/ci-calendar.js";

/** Version du schéma de features (estampille `featureSetVersion`, CONTRACT-008). */
export const FEATURE_SET_VERSION = "fs-v1" as const;

/** Seuil d'historique minimal (jours) — aligné CONTRACT-008 `INSUFFICIENT_HISTORY`. */
export const HISTORY_THRESHOLD_DAYS = 90 as const;

/** Granularités de bucket supportées (minutes) sans migration de schéma. */
export type BucketMinutes = 30 | 60;

/**
 * Observation horaire BRUTE d'un bucket, dérivée des faits SIGFA du tenant.
 *
 * Les mesures proviennent de l'extraction certifiée (REP-001 pour les daily
 * stats, agrégation horaire des `tickets` pour la granularité bucket). Elles ne
 * sont JAMAIS recalculées dans ce moteur.
 */
export interface RawBucketObservation {
  /** Tenant (banque). */
  readonly bankId: string;
  /** Agence. */
  readonly agencyId: string;
  /** Service (optionnel — null = tous services confondus). */
  readonly serviceId: string | null;
  /** Jour civil Abidjan `YYYY-MM-DD`. */
  readonly date: string;
  /** Index de bucket dans la journée (0-based). Horaire : 0–23. 30 min : 0–47. */
  readonly hourBucket: number;
  /** Largeur du bucket en minutes (30 ou 60). */
  readonly bucketMinutes: BucketMinutes;
  /** Tickets émis (arrivées) dans le bucket. */
  readonly arrivals: number;
  /** Tickets servis (DONE). */
  readonly served: number;
  /** Tickets non-présentés (NO_SHOW). */
  readonly noShow: number;
  /** Tickets abandonnés (ABANDONED). */
  readonly abandoned: number;
  /** Somme des temps d'attente (secondes) — base TMA REP-001. */
  readonly totalWaitSeconds: number;
  /** 90e centile du temps d'attente (secondes) — fourni par l'extraction. */
  readonly p90WaitSeconds: number;
  /** Somme des temps de service (secondes) — base TMT REP-001. */
  readonly totalServiceSeconds: number;
  /** Nb de guichets ouverts observés. */
  readonly countersOpen: number;
  /** Nb d'agents actifs observés. */
  readonly agentsActive: number;
  /**
   * `true` si le bucket est incomplet (journée partielle, coupure, agence
   * récente) — décidé par l'extraction. Le moteur ne fabrique jamais de valeur.
   */
  readonly isPartialSource: boolean;
}

/** Enregistrement de feature matérialisable (clé canonique + features dérivées). */
export interface FeatureRecord {
  // ── Clé canonique ──────────────────────────────────────────────────────────
  readonly bankId: string;
  readonly agencyId: string;
  readonly serviceId: string | null;
  readonly date: string;
  readonly hourBucket: number;
  readonly bucketMinutes: BucketMinutes;
  // ── Mesures de bucket (issues REP-001 / extraction, non recalculées) ─────────
  readonly arrivals: number;
  readonly served: number;
  readonly noShow: number;
  readonly abandoned: number;
  /** TMA du bucket (moyenne attente s) — `totalWaitSeconds / served`, null si served=0. */
  readonly avgWaitSeconds: number | null;
  readonly p90WaitSeconds: number;
  /** TMT du bucket (moyenne service s) — `totalServiceSeconds / served`, null si served=0. */
  readonly avgServiceSeconds: number | null;
  readonly countersOpen: number;
  readonly agentsActive: number;
  // ── Features calendaires (CONTRACT-008) ──────────────────────────────────────
  readonly dayOfWeek: number;
  readonly isMonthEnd: boolean;
  readonly isPublicPayDay: boolean;
  readonly isPublicHoliday: boolean;
  readonly isEveOfHoliday: boolean;
  readonly factors: readonly ContextualFactor[];
  // ── Features LAG ─────────────────────────────────────────────────────────────
  /** Arrivées du même bucket la veille (J-1). null si absent. */
  readonly arrivalsLag1d: number | null;
  /** Arrivées du même bucket 7 jours avant (J-7). null si absent. */
  readonly arrivalsLag7d: number | null;
  /**
   * Moyenne des arrivées du même bucket sur 4 semaines glissantes
   * (J-7, J-14, J-21, J-28). null si aucun des 4 points n'est disponible.
   * Moyenne des seuls points présents (pas d'imputation à 0).
   */
  readonly arrivalsRollMean4w: number | null;
  // ── Métadonnées ──────────────────────────────────────────────────────────────
  /** Bucket incomplet — aucune imputation. */
  readonly isPartial: boolean;
  /** Nb de jours civils distincts observés pour l'agence (base seuil 90 j). */
  readonly availableDays: number;
  /** Version du schéma de features. */
  readonly featureSetVersion: string;
}

/** Options de calcul du feature-set (horloge injectée, calendrier, paie). */
export interface FeatureComputeOptions {
  /** Jeu de jours fériés CI (`YYYY-MM-DD`), source seed DB-003 (injecté). */
  readonly holidays: ReadonlySet<string>;
  /** Horloge injectée — détermine `isPartial` (jour figé J+2 07:00 Abidjan). */
  readonly now: Date;
  /** Config paie fonction publique (défaut : jour 25 → fin de mois). */
  readonly payDayConfig?: PayDayConfig;
}

/** Clé jour d'une série (série + date), pour l'indexation des lags. */
function seriesDayKey(agencyId: string, serviceId: string | null, hourBucket: number, date: string): string {
  return `${agencyId}|${serviceId ?? "∅"}|${hourBucket}|${date}`;
}

/** Recule un jour civil de `backDays` jours (lags), via l'arithmétique pure du calendrier. */
function shiftBack(day: string, backDays: number): string {
  let d = day;
  for (let i = 0; i < backDays; i += 1) d = previousDay(d);
  return d;
}

/** Moyenne des valeurs présentes (non-null). null si aucune valeur présente. */
function meanOfPresent(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  const sum = present.reduce((acc, v) => acc + v, 0);
  return sum / present.length;
}

/** Division sûre `num/den` → null si `den <= 0`. */
function safeDiv(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

/**
 * Calcule le feature-set déterministe pour une série d'observations horaires.
 *
 * Étapes :
 *  1. Index des arrivées par `(série, jour)` pour les lags (aucune I/O).
 *  2. `availableDays` par agence = nb de jours civils distincts observés.
 *  3. Pour chaque observation : mesures + calendrier + lags + `isPartial`.
 *
 * Idempotence de calcul : mêmes entrées ⇒ mêmes sorties, ordonnées de façon
 * stable par clé canonique.
 *
 * @param observations - Observations horaires brutes du tenant (peuvent mêler
 *                        plusieurs agences — l'isolation `bankId` est garantie en
 *                        amont par la couche extraction sous `withTenant`).
 * @param options      - Calendrier, horloge, config paie
 * @returns Un `FeatureRecord` par observation, trié par clé canonique
 */
export function computeFeatureSet(
  observations: readonly RawBucketObservation[],
  options: FeatureComputeOptions
): FeatureRecord[] {
  const payCfg = options.payDayConfig ?? DEFAULT_PAY_DAY_CONFIG;

  // 1. Index arrivées par (série, jour) — base des lags.
  const arrivalsBySeriesDay = new Map<string, number>();
  // 2. Jours distincts par agence — base availableDays.
  const daysByAgency = new Map<string, Set<string>>();

  for (const o of observations) {
    arrivalsBySeriesDay.set(
      seriesDayKey(o.agencyId, o.serviceId, o.hourBucket, o.date),
      o.arrivals
    );
    const set = daysByAgency.get(o.agencyId) ?? new Set<string>();
    set.add(o.date);
    daysByAgency.set(o.agencyId, set);
  }

  const lagArrivals = (o: RawBucketObservation, backDays: number): number | null => {
    const day = shiftBack(o.date, backDays);
    const key = seriesDayKey(o.agencyId, o.serviceId, o.hourBucket, day);
    const v = arrivalsBySeriesDay.get(key);
    return v === undefined ? null : v;
  };

  const records: FeatureRecord[] = observations.map((o) => {
    const cal: CalendarFlags = calendarFlags(o.date, options.holidays, payCfg);
    const lag1d = lagArrivals(o, 1);
    const lag7d = lagArrivals(o, 7);
    const roll4w = meanOfPresent([
      lagArrivals(o, 7),
      lagArrivals(o, 14),
      lagArrivals(o, 21),
      lagArrivals(o, 28),
    ]);
    // isPartial : source incomplète OU jour non encore figé (aligné REP-001).
    const partial = o.isPartialSource || isDayPartial(o.date, options.now);
    const availableDays = daysByAgency.get(o.agencyId)?.size ?? 0;

    return {
      bankId: o.bankId,
      agencyId: o.agencyId,
      serviceId: o.serviceId,
      date: o.date,
      hourBucket: o.hourBucket,
      bucketMinutes: o.bucketMinutes,
      arrivals: o.arrivals,
      served: o.served,
      noShow: o.noShow,
      abandoned: o.abandoned,
      avgWaitSeconds: safeDiv(o.totalWaitSeconds, o.served),
      p90WaitSeconds: o.p90WaitSeconds,
      avgServiceSeconds: safeDiv(o.totalServiceSeconds, o.served),
      countersOpen: o.countersOpen,
      agentsActive: o.agentsActive,
      dayOfWeek: cal.dayOfWeek,
      isMonthEnd: cal.isMonthEnd,
      isPublicPayDay: cal.isPublicPayDay,
      isPublicHoliday: cal.isPublicHoliday,
      isEveOfHoliday: cal.isEveOfHoliday,
      factors: cal.factors,
      arrivalsLag1d: lag1d,
      arrivalsLag7d: lag7d,
      arrivalsRollMean4w: roll4w,
      isPartial: partial,
      availableDays,
      featureSetVersion: FEATURE_SET_VERSION,
    };
  });

  return sortByCanonicalKey(records);
}

/** Compare deux `FeatureRecord` par clé canonique (ordre stable, déterministe). */
function compareCanonicalKey(a: FeatureRecord, b: FeatureRecord): number {
  if (a.bankId !== b.bankId) return a.bankId < b.bankId ? -1 : 1;
  if (a.agencyId !== b.agencyId) return a.agencyId < b.agencyId ? -1 : 1;
  const sa = a.serviceId ?? "";
  const sb = b.serviceId ?? "";
  if (sa !== sb) return sa < sb ? -1 : 1;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.hourBucket - b.hourBucket;
}

/** Trie une liste de features par clé canonique (nouvelle liste, non mutante). */
export function sortByCanonicalKey(records: readonly FeatureRecord[]): FeatureRecord[] {
  return [...records].sort(compareCanonicalKey);
}

/** Clé canonique stable d'un record (unicité upsert / matérialisation). */
export function canonicalKey(r: {
  bankId: string;
  agencyId: string;
  serviceId: string | null;
  date: string;
  hourBucket: number;
}): string {
  return seriesDayKey(r.agencyId, r.serviceId, r.hourBucket, r.date) + `|${r.bankId}`;
}
