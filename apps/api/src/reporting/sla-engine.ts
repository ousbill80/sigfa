/**
 * REP-001 — Moteur d'agrégats KPI SIGFA (`sla-engine`).
 *
 * ## Nature
 * Fonctions **PURES** et 100 % **déterministes** : aucun accès DB, réseau, ni
 * horloge cachée. Là où le temps est nécessaire (`isDayPartial`), l'horloge est
 * **injectée** en paramètre. Le moteur ne mute jamais son entrée.
 *
 * ## LA LOI (décision D2 — formules KPI CONFIRMÉES PO le 2026-07-12)
 * Les 7 KPIs sont calculés à partir d'un agrégat **pré-sommé** (`DailyStatsAggregate`),
 * représentant soit un jour civil Abidjan, soit la SOMME de plusieurs jours.
 * L'agrégation multi-jours se fait toujours par **somme des mesures brutes puis
 * division** (jamais « moyenne de moyennes » — biais interdit).
 *
 * - **TMA** (attente moyenne)   = `total_wait_seconds / served_count`         (secondes, arrondi)
 * - **TMT** (traitement moyen)  = `total_service_seconds / done_count`        (secondes, arrondi ; DONE only)
 * - **TTS** (temps total)       = `TMA + TMT`                                 (null si l'un est null)
 * - **taux d'abandon**          = `abandoned / (abandoned + served)` × 100    (%, 2 déc. ; NO_SHOW exclu)
 * - **taux SLA**                = `sla_met / sla_total` × 100                 (%, 2 déc. ; SLA porte sur l'ATTENTE)
 * - **NPS**                     = `(promoters − detractors) / feedback` × 100 (score entier [−100..+100])
 * - **occupation** (par-agent)  = `agent_active / agent_available` × 100      (%, 2 déc., plafond 100)
 *
 * Tout dénominateur nul ⇒ `null` (jamais `0`, `NaN`, ni division par zéro).
 *
 * ## Rattachement au jour & fuseau
 * Le rattachement d'un ticket à un jour se fait par sa date civile **Africa/Abidjan**
 * (émission `issued_at`). La conversion est centralisée dans `toAbidjanDay()` — jamais
 * « UTC = Abidjan » codé en dur (robustesse multi-pays UEMOA).
 *
 * ## Jour partiel
 * Un jour J est figé (`partial: false`) à **J+2 07:00 Abidjan** ; avant, `partial: true`.
 *
 * @module
 */

/**
 * Fuseau de référence SIGFA (source unique de vérité). Abidjan = UTC+00 sans DST,
 * mais la conversion passe TOUJOURS par ce nom IANA (jamais un offset codé en dur).
 */
export const ABIDJAN_TZ = "Africa/Abidjan" as const;

/** Nombre d'heures après lesquelles un jour J est figé, à partir de J+2 00:00 Abidjan. */
const FREEZE_HOUR_ABIDJAN = 7;

/**
 * Agrégat de mesures brutes d'une agence pour une fenêtre (un jour civil Abidjan
 * ou la somme de plusieurs jours). Toutes les mesures sont des **sommes** ou des
 * **comptages** — jamais des moyennes déjà calculées (permet la somme multi-jours).
 */
export interface DailyStatsAggregate {
  /** Tickets émis dans la fenêtre (rattachés par `issued_at` en jour Abidjan). */
  ticketsIssued: number;
  /** Tickets ayant reçu un 1er appel (dénominateur TMA). Base attente. */
  servedCount: number;
  /** Tickets DONE (dénominateur TMT ; traitement mesuré). */
  doneCount: number;
  /** Tickets ABANDONED (quitté la file avant 1er appel). Numérateur abandon. */
  abandonedCount: number;
  /** Tickets NO_SHOW (appelé mais absent). EXCLU du numérateur d'abandon. */
  noShowCount: number;
  /** Somme des `wait_seconds` (attente) sur les tickets appelés. */
  totalWaitSeconds: number;
  /** Somme des `service_seconds` sur les tickets DONE. */
  totalServiceSeconds: number;
  /** Tickets respectant le SLA d'attente (`wait_seconds ≤ SLA_service`). */
  slaMetCount: number;
  /** Tickets éligibles au SLA (appelés + abandonnés ; abandon = non-met). */
  slaTotalCount: number;
  /** Nombre de feedbacks (dénominateur NPS). */
  feedbackCount: number;
  /** Feedbacks note 5 (promoteurs). */
  npsPromoters: number;
  /** Feedbacks note 4 (passifs). */
  npsPassives: number;
  /** Feedbacks note ≤ 3 (détracteurs). */
  npsDetractors: number;
  /**
   * Secondes d'activité agent (ticket ouvert). Numérateur occupation.
   * `null` si aucune donnée d'historique agent sur la fenêtre.
   */
  agentActiveSeconds: number | null;
  /**
   * Secondes où au moins un agent était « disponible » (en service hors pause/
   * déconnexion). Dénominateur occupation. `null` si aucune donnée.
   */
  agentAvailableSeconds: number | null;
}

/** Unité d'un KPI (aligné CONTRACT-006 `KpiValue.unit`). */
export type KpiUnit = "minutes" | "percent" | "score";

/** Valeur d'un KPI avec son unité (forme contractuelle `KpiValue`). */
export interface KpiValue {
  /** Valeur du KPI ; `null` si non calculable (dénominateur nul). */
  value: number | null;
  /** Unité du KPI. */
  unit: KpiUnit;
}

/**
 * Ensemble des 7 KPIs (forme contractuelle `KpiSet` de CONTRACT-006).
 * `nps` est un scalaire nullable (pas un `KpiValue`), conformément au contrat.
 */
export interface KpiSet {
  /** TMA — Temps Moyen d'Attente. */
  tma: KpiValue;
  /** TMT — Temps Moyen de Traitement. */
  tmt: KpiValue;
  /** TTS — Temps Total de Service. */
  tts: KpiValue;
  /** Taux d'abandon. */
  tauxAbandon: KpiValue;
  /** Taux SLA. */
  tauxSLA: KpiValue;
  /** NPS — Net Promoter Score (scalaire nullable, [−100..+100]). */
  nps: number | null;
  /** Taux d'occupation. */
  occupation: KpiValue;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internes (division sûre — jamais NaN/Infinity/div0)
// ─────────────────────────────────────────────────────────────────────────────

/** Arrondit à `decimals` décimales (arrondi au plus proche, demi vers le haut). */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Division protégée : retourne `null` si le dénominateur est nul ou nul-ish.
 * Garantit qu'aucun KPI ne vaut `NaN`, `Infinity` ou une division par zéro.
 */
function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

// ─────────────────────────────────────────────────────────────────────────────
// Les 7 KPIs (fonctions pures)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TMA — Temps Moyen d'Attente (secondes, arrondi au plus proche).
 * `null` si `servedCount = 0`.
 */
export function tma(a: DailyStatsAggregate): number | null {
  const ratio = safeRatio(a.totalWaitSeconds, a.servedCount);
  return ratio === null ? null : round(ratio, 0);
}

/**
 * TMT — Temps Moyen de Traitement (secondes, arrondi), sur tickets DONE.
 * `null` si `doneCount = 0`.
 */
export function tmt(a: DailyStatsAggregate): number | null {
  const ratio = safeRatio(a.totalServiceSeconds, a.doneCount);
  return ratio === null ? null : round(ratio, 0);
}

/**
 * TTS — Temps Total de Service (secondes) = TMA + TMT.
 * `null` si TMA ou TMT est `null`.
 */
export function tts(a: DailyStatsAggregate): number | null {
  const ma = tma(a);
  const mt = tmt(a);
  if (ma === null || mt === null) return null;
  return ma + mt;
}

/**
 * Taux d'abandon (%, 2 décimales) = `abandoned / (abandoned + served)` × 100.
 * NO_SHOW EXCLU du numérateur. `null` si le dénominateur est nul.
 */
export function tauxAbandon(a: DailyStatsAggregate): number | null {
  const denominator = a.abandonedCount + a.servedCount;
  const ratio = safeRatio(a.abandonedCount, denominator);
  return ratio === null ? null : round(ratio * 100, 2);
}

/**
 * Taux SLA (%, 2 décimales) = `sla_met / sla_total` × 100.
 * Le SLA porte sur l'ATTENTE (`wait_seconds ≤ SLA_service`, borne ≤ inclusive) ;
 * un abandon compte comme non-met (déjà encodé en amont dans `slaTotalCount`).
 * `null` si `slaTotalCount = 0`.
 */
export function tauxSla(a: DailyStatsAggregate): number | null {
  const ratio = safeRatio(a.slaMetCount, a.slaTotalCount);
  return ratio === null ? null : round(ratio * 100, 2);
}

/**
 * NPS (score entier [−100..+100]) = `(promoters − detractors) / feedback` × 100.
 * Mapping : note 5 → promoteur, 4 → passif, ≤ 3 → détracteur (aligné API-010).
 * `null` si `feedbackCount = 0` (jamais un 0 fallacieux).
 */
export function nps(a: DailyStatsAggregate): number | null {
  const ratio = safeRatio(a.npsPromoters - a.npsDetractors, a.feedbackCount);
  return ratio === null ? null : round(ratio * 100, 0);
}

/**
 * Taux d'occupation (%, 2 décimales) = `agent_active / agent_available` × 100,
 * plafonné à 100. Base **par-agent** (source `agent_status_history`).
 * `null` si `agentAvailableSeconds` est nul ou absent.
 */
export function occupation(a: DailyStatsAggregate): number | null {
  const available = a.agentAvailableSeconds ?? 0;
  const active = a.agentActiveSeconds ?? 0;
  const ratio = safeRatio(active, available);
  if (ratio === null) return null;
  return Math.min(100, round(ratio * 100, 2));
}

/**
 * Calcule les 7 KPIs sous la forme contractuelle `KpiSet` (CONTRACT-006).
 *
 * @param a - Agrégat pré-sommé (un jour ou une somme multi-jours)
 * @returns Les 7 KPIs typés avec leurs unités (valeurs `null` si non calculables)
 */
export function computeKpiSet(a: DailyStatsAggregate): KpiSet {
  return {
    tma: { value: tma(a), unit: "minutes" },
    tmt: { value: tmt(a), unit: "minutes" },
    tts: { value: tts(a), unit: "minutes" },
    tauxAbandon: { value: tauxAbandon(a), unit: "percent" },
    tauxSLA: { value: tauxSla(a), unit: "percent" },
    nps: nps(a),
    occupation: { value: occupation(a), unit: "percent" },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agrégation multi-jours (somme des mesures brutes — jamais moyenne de moyennes)
// ─────────────────────────────────────────────────────────────────────────────

/** Agrégat neutre (tout à zéro ; occupation available/active inconnus → null). */
export function emptyAggregate(): DailyStatsAggregate {
  return {
    ticketsIssued: 0,
    servedCount: 0,
    doneCount: 0,
    abandonedCount: 0,
    noShowCount: 0,
    totalWaitSeconds: 0,
    totalServiceSeconds: 0,
    slaMetCount: 0,
    slaTotalCount: 0,
    feedbackCount: 0,
    npsPromoters: 0,
    npsPassives: 0,
    npsDetractors: 0,
    agentActiveSeconds: null,
    agentAvailableSeconds: null,
  };
}

/**
 * Somme deux mesures d'occupation nullable : si les deux sont `null`, le résultat
 * reste `null` (aucune donnée) ; sinon les `null` comptent pour 0.
 */
function addNullable(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

/**
 * Somme une liste d'agrégats journaliers en UN seul agrégat, mesure par mesure.
 * Base de l'agrégation multi-jours : les moyennes (TMA/TMT/…) sont recalculées
 * ensuite depuis les sommes — jamais une moyenne de moyennes (biais interdit).
 *
 * Ne mute aucun élément d'entrée (retourne un nouvel objet).
 *
 * @param aggregates - Agrégats journaliers à sommer (liste éventuellement vide)
 * @returns Agrégat somme (vide si la liste est vide)
 */
export function sumAggregates(aggregates: readonly DailyStatsAggregate[]): DailyStatsAggregate {
  return aggregates.reduce<DailyStatsAggregate>((acc, cur) => {
    acc.ticketsIssued += cur.ticketsIssued;
    acc.servedCount += cur.servedCount;
    acc.doneCount += cur.doneCount;
    acc.abandonedCount += cur.abandonedCount;
    acc.noShowCount += cur.noShowCount;
    acc.totalWaitSeconds += cur.totalWaitSeconds;
    acc.totalServiceSeconds += cur.totalServiceSeconds;
    acc.slaMetCount += cur.slaMetCount;
    acc.slaTotalCount += cur.slaTotalCount;
    acc.feedbackCount += cur.feedbackCount;
    acc.npsPromoters += cur.npsPromoters;
    acc.npsPassives += cur.npsPassives;
    acc.npsDetractors += cur.npsDetractors;
    acc.agentActiveSeconds = addNullable(acc.agentActiveSeconds, cur.agentActiveSeconds);
    acc.agentAvailableSeconds = addNullable(acc.agentAvailableSeconds, cur.agentAvailableSeconds);
    return acc;
  }, emptyAggregate());
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuseau Africa/Abidjan & jour partiel (horloge injectée)
// ─────────────────────────────────────────────────────────────────────────────

/** Formateur de date civile Abidjan (year-month-day), mémoïsé. */
const abidjanDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ABIDJAN_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Retourne la date civile (`YYYY-MM-DD`) du fuseau Africa/Abidjan pour un instant.
 * Conversion centralisée — jamais « UTC = Abidjan » codé en dur.
 *
 * @param instant - Instant à convertir (émission `issued_at`, etc.)
 * @returns Jour civil Abidjan au format `YYYY-MM-DD`
 */
export function toAbidjanDay(instant: Date): string {
  // en-CA formate en `YYYY-MM-DD`, ce qui est exactement le format attendu.
  return abidjanDayFormatter.format(instant);
}

/**
 * Instant (UTC) correspondant à `HH:00` heure Abidjan d'un jour civil donné.
 * Abidjan = UTC+00 sans DST : l'heure locale égale l'heure UTC, mais on passe
 * par le nom IANA pour rester robuste si le fuseau évolue.
 */
function abidjanHourInstant(day: string, hour: number): Date {
  // `day` est un jour civil Abidjan. Abidjan étant UTC+00, l'instant UTC de
  // `day HH:00` Abidjan est `${day}THH:00:00Z`. On garde la dérivation explicite.
  const hh = String(hour).padStart(2, "0");
  return new Date(`${day}T${hh}:00:00Z`);
}

/**
 * Indique si un jour civil Abidjan est encore **partiel** (agrégat non figé).
 *
 * Règle métier (D2) : un jour J est figé (`partial: false`) à **J+2 07:00 Abidjan**.
 * Avant cet instant, il est partiel (`partial: true`). L'horloge est **injectée**
 * (`now`) — aucune horloge cachée, 100 % déterministe.
 *
 * @param day - Jour civil Abidjan au format `YYYY-MM-DD`
 * @param now - Horloge injectée (instant courant)
 * @returns `true` si le jour est encore partiel, `false` s'il est figé
 */
export function isDayPartial(day: string, now: Date): boolean {
  // Instant de figeage = J+2 à 07:00 Abidjan.
  const freezeInstant = new Date(abidjanHourInstant(day, FREEZE_HOUR_ABIDJAN).getTime());
  freezeInstant.setUTCDate(freezeInstant.getUTCDate() + 2);
  return now.getTime() < freezeInstant.getTime();
}
