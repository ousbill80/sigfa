/**
 * REP-003 — Benchmarking inter-agences (fonctions PURES).
 *
 * Classe les agences d'un tenant sur un KPI de tri (`sortKpi`, défaut `tauxSLA`)
 * pour une période, en normalisant le SENS de chaque KPI :
 *  - **plus haut = mieux** : `tauxSLA`, `nps`, `occupation`
 *  - **plus bas = mieux**  : `tma`, `tmt`, `tts`, `tauxAbandon`
 *
 * Le STATUT couleur (VERT/ORANGE/ROUGE) est calculé sur les seuils SLA + TMA
 * documentés (CONTRACT-006), configurables par banque. Une agence SANS donnée sur
 * la période reçoit le statut **`n/a`** (additif CONTRACT-013) — JAMAIS classée
 * `ROUGE` par défaut, et TOUJOURS reléguée en fin de classement.
 *
 * Aucune formule KPI n'est réimplémentée : les valeurs viennent de REP-001
 * (`computeKpiSet` via `sla-engine`). Zéro I/O, zéro horloge cachée.
 *
 * @module
 */

import {
  computeKpiSet,
  type DailyStatsAggregate,
} from "src/reporting/sla-engine.js";

/** KPI utilisable comme clé de tri du benchmark (aligné CONTRACT-006 `sortKpi`). */
export type SortKpi =
  | "tauxSLA"
  | "tma"
  | "tmt"
  | "tts"
  | "tauxAbandon"
  | "nps"
  | "occupation";

/** KPI par défaut du classement (CONTRACT-006). */
export const DEFAULT_SORT_KPI: SortKpi = "tauxSLA";

/**
 * Sens de chaque KPI : `true` = « plus haut est meilleur », `false` = « plus bas
 * est meilleur ». Base de la NORMALISATION du tri (SLA/NPS↑ vs TMA/abandon↓).
 */
export const KPI_HIGHER_IS_BETTER: Record<SortKpi, boolean> = {
  tauxSLA: true,
  nps: true,
  occupation: true,
  tma: false,
  tmt: false,
  tts: false,
  tauxAbandon: false,
};

/** Statut couleur du benchmark (aligné `BenchmarkStatus` CONTRACT-006). */
export type BenchmarkStatus = "VERT" | "ORANGE" | "ROUGE" | "n/a";

/** Seuils SLA + TMA de classification (configurables par banque). */
export interface BenchmarkThresholds {
  /** Seuils SLA (%) : `vert` = minimum VERT, `orange` = minimum ORANGE. */
  sla: { vert: number; orange: number };
  /** Seuils TMA (minutes) : `vert` = maximum VERT, `orange` = maximum ORANGE. */
  tma: { vert: number; orange: number };
}

/** Seuils par défaut UEMOA (CONTRACT-006). */
export const DEFAULT_THRESHOLDS: BenchmarkThresholds = {
  sla: { vert: 80, orange: 60 },
  tma: { vert: 15, orange: 25 },
};

/** Entrée d'agence en ENTRÉE du benchmark (agrégat + identité pour le tenant). */
export interface AgencyBenchmarkInput {
  /** Identifiant de l'agence. */
  agencyId: string;
  /** Nom de l'agence. */
  agencyName: string;
  /** Agrégat pré-sommé de la période (REP-001) ; `null` = aucune donnée. */
  aggregate: DailyStatsAggregate | null;
}

/** Entrée de classement en SORTIE (conforme `BenchmarkEntry` CONTRACT-006). */
export interface BenchmarkEntry {
  /** Rang (1 = meilleur). */
  rank: number;
  /** Identifiant de l'agence. */
  agencyId: string;
  /** Nom de l'agence. */
  agencyName: string;
  /** Statut couleur (n/a si aucune donnée). */
  status: BenchmarkStatus;
  /** Taux SLA de l'agence (%, `null` si non calculable). */
  tauxSLA: number | null;
  /** TMA de l'agence (minutes, `null` si non calculable). */
  tma: number | null;
}

/** Nombre de secondes par minute (conversion durée moteur → minutes exposées). */
const SECONDS_PER_MINUTE = 60;

/** Convertit une durée moteur (secondes) en minutes (1 décimale), `null` inchangé. */
function toMinutes(seconds: number | null): number | null {
  if (seconds === null) return null;
  return Math.round((seconds / SECONDS_PER_MINUTE) * 10) / 10;
}

/**
 * Détermine le statut couleur d'une agence à partir de son taux SLA (%) et de son
 * TMA (minutes), selon les seuils. Toute valeur manquante côté SLA/TMA (aucune
 * donnée) est traitée par l'appelant en amont (`n/a`) — ici les deux sont présents.
 *
 * Règle (CONTRACT-006) :
 *  - VERT   : SLA ≥ sla.vert ET TMA ≤ tma.vert
 *  - ROUGE  : SLA < sla.orange OU TMA > tma.orange
 *  - ORANGE : entre les deux
 *
 * @param slaPercent - Taux SLA en %
 * @param tmaMinutes - TMA en minutes
 * @param thresholds - Seuils SLA/TMA
 * @returns Statut couleur (jamais `n/a` ici)
 */
export function classifyStatus(
  slaPercent: number,
  tmaMinutes: number,
  thresholds: BenchmarkThresholds
): Exclude<BenchmarkStatus, "n/a"> {
  const { sla, tma } = thresholds;
  if (slaPercent >= sla.vert && tmaMinutes <= tma.vert) return "VERT";
  if (slaPercent < sla.orange || tmaMinutes > tma.orange) return "ROUGE";
  return "ORANGE";
}

/**
 * Valeur normalisée « plus grand = meilleur » d'un KPI, pour le tri du classement.
 * Un KPI « plus bas est meilleur » (TMA/abandon) est nié pour que le tri décroissant
 * reste homogène. `null` (non calculable) est renvoyé tel quel (relégué en fin).
 *
 * @param kpi   - KPI de tri
 * @param value - Valeur brute du KPI (déjà en unité exposée)
 * @returns Score normalisé (plus grand = meilleur), ou `null`
 */
export function normalizedScore(kpi: SortKpi, value: number | null): number | null {
  if (value === null) return null;
  return KPI_HIGHER_IS_BETTER[kpi] ? value : -value;
}

/** Valeur exposée d'un KPI de tri pour une agence (unités contractuelles). */
function sortKpiValue(kpi: SortKpi, agg: DailyStatsAggregate): number | null {
  const kpis = computeKpiSet(agg);
  switch (kpi) {
    case "tauxSLA":
      return kpis.tauxSLA.value;
    case "tauxAbandon":
      return kpis.tauxAbandon.value;
    case "occupation":
      return kpis.occupation.value;
    case "nps":
      return kpis.nps;
    case "tma":
      return toMinutes(kpis.tma.value);
    case "tmt":
      return toMinutes(kpis.tmt.value);
    /* v8 ignore next 2 — `tts` : dernière branche, exhaustivité de l'union SortKpi. */
    case "tts":
      return toMinutes(kpis.tts.value);
  }
}

/** Ligne intermédiaire de tri : entrée + score normalisé (null = fin de classement). */
interface RankableRow {
  entry: Omit<BenchmarkEntry, "rank">;
  score: number | null;
  hasData: boolean;
}

/** Construit la ligne de classement d'une agence (statut + valeurs + score de tri). */
function buildRow(
  input: AgencyBenchmarkInput,
  sortKpi: SortKpi,
  thresholds: BenchmarkThresholds
): RankableRow {
  if (input.aggregate === null) {
    // Aucune donnée sur la période → n/a (jamais ROUGE par défaut), relégué en fin.
    return {
      entry: {
        agencyId: input.agencyId,
        agencyName: input.agencyName,
        status: "n/a",
        tauxSLA: null,
        tma: null,
      },
      score: null,
      hasData: false,
    };
  }
  const kpis = computeKpiSet(input.aggregate);
  const slaValue = kpis.tauxSLA.value;
  const tmaMinutes = toMinutes(kpis.tma.value);
  // Sans SLA ni TMA calculables, on ne peut pas classer par couleur → n/a.
  const status: BenchmarkStatus =
    slaValue === null || tmaMinutes === null
      ? "n/a"
      : classifyStatus(slaValue, tmaMinutes, thresholds);
  const hasData = status !== "n/a";
  return {
    entry: {
      agencyId: input.agencyId,
      agencyName: input.agencyName,
      status,
      tauxSLA: slaValue,
      tma: tmaMinutes,
    },
    score: hasData ? normalizedScore(sortKpi, sortKpiValue(sortKpi, input.aggregate)) : null,
    hasData,
  };
}

/**
 * Classe les agences d'un tenant sur `sortKpi` (sens normalisé) et attribue le rang
 * + le statut couleur à chacune. Les agences sans donnée (`n/a`) sont TOUJOURS en
 * fin de classement (jamais mêlées aux agences classées, jamais `ROUGE`).
 *
 * Tri stable : à score égal, l'ordre d'entrée (par `agencyId`) est préservé.
 *
 * @param inputs     - Agences + agrégats de la période (REP-001)
 * @param sortKpi    - KPI de tri (défaut `tauxSLA`)
 * @param thresholds - Seuils de classification (défaut UEMOA)
 * @returns Classement ordonné (rang 1 = meilleur), agences `n/a` en fin
 */
export function rankAgencies(
  inputs: readonly AgencyBenchmarkInput[],
  sortKpi: SortKpi = DEFAULT_SORT_KPI,
  thresholds: BenchmarkThresholds = DEFAULT_THRESHOLDS
): BenchmarkEntry[] {
  const rows = inputs.map((input) => buildRow(input, sortKpi, thresholds));
  const ranked = rows.filter((r) => r.hasData && r.score !== null);
  const naRows = rows.filter((r) => !r.hasData || r.score === null);
  // Tri décroissant par score normalisé (plus grand = meilleur), stable par agencyId.
  ranked.sort((a, b) => {
    const diff = (b.score as number) - (a.score as number);
    if (diff !== 0) return diff;
    return a.entry.agencyId.localeCompare(b.entry.agencyId);
  });
  naRows.sort((a, b) => a.entry.agencyId.localeCompare(b.entry.agencyId));
  return [...ranked, ...naRows].map((row, index) => ({
    rank: index + 1,
    ...row.entry,
  }));
}
