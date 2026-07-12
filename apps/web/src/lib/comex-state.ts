/**
 * COMEX dashboard state model (WEB-005).
 *
 * Pure derivation of the exactly-3 COMEX KPIs (NPS global réseau, TMA moyen
 * réseau, Volume clients servis) from the CANONICAL network aggregate returned by
 * GET /reports/kpis?scope=network (contract reporting.yaml — the /reports/comex
 * route is a REJECTED invention). Month-over-month deltas come from the previous
 * period aggregate. `--danger` is reserved for real alerts (TMA > 2×SLA, negative
 * NPS) and is never decorative (Design System §9). Partial months (null NPS, zero
 * volume) are flagged so the view can annotate "données partielles" instead of a
 * raw 0.
 * @module lib/comex-state
 */

/** Exactly three KPIs on the COMEX dashboard (Design System "une info principale"). */
export const COMEX_KPI_COUNT = 3 as const;

/**
 * Network aggregate fields consumed by the COMEX KPIs.
 *
 * `avgTma`, `totalTickets`, `avgTauxSLA` and `agencyCount` come straight from the
 * contract's `AnonymizedNetworkAggregate`. `nps` is NOT part of the typed network
 * aggregate (the contract only types it per-agency); it is read defensively from
 * the mock when present and is `null`/`undefined` otherwise → partial data.
 */
export interface NetworkAggregate {
  /** Network average TMA in minutes. */
  avgTma: number;
  /** Total tickets served on the period (network volume). */
  totalTickets: number;
  /** Network average SLA rate, percent. */
  avgTauxSLA: number;
  /** Number of agencies contributing (anonymised). */
  agencyCount: number;
  /** Network NPS (–100..100), null when no feedback was collected. */
  nps?: number | null;
}

/** The NPS KPI (global réseau). */
export interface NpsKpi {
  /** NPS value (–100..100), null when unavailable. */
  value: number | null;
  /** Delta vs previous month, null when no comparison is available. */
  delta: number | null;
  /** Whether the value is derived from a partial/absent dataset. */
  partial: boolean;
}

/** The TMA KPI (moyen réseau). */
export interface TmaKpi {
  /** TMA in minutes, null when unavailable. */
  value: number | null;
  /** Whether the value is derived from a partial/absent dataset. */
  partial: boolean;
}

/** The Volume KPI (clients servis). */
export interface VolumeKpi {
  /** Volume of clients served (current month). */
  value: number;
  /** Delta percent vs previous month, null when no comparison is available. */
  deltaPct: number | null;
  /** Whether the value is derived from a partial/absent dataset. */
  partial: boolean;
}

/** The exactly-3 COMEX KPIs. */
export interface ComexKpis {
  /** NPS global réseau. */
  nps: NpsKpi;
  /** TMA moyen réseau. */
  tma: TmaKpi;
  /** Volume clients servis. */
  volume: VolumeKpi;
}

/** Design-System status colour tokens usable on a KPI value. */
export type KpiColor = "var(--success)" | "var(--warning)" | "var(--danger)" | "var(--ink-strong)";

/**
 * Maps a network TMA (minutes) to an SLA colour token.
 * `--danger` is used ONLY when TMA > 2×SLA (a real breach) — never decorative.
 * @param tma - Network TMA in minutes.
 * @param slaMinutes - Configured network SLA target in minutes.
 * @returns The colour token.
 */
export function tmaSlaColor(tma: number, slaMinutes: number): KpiColor {
  if (tma <= slaMinutes) return "var(--success)";
  if (tma <= 2 * slaMinutes) return "var(--warning)";
  return "var(--danger)";
}

/**
 * Maps an NPS value to a colour token.
 * `--danger` only when NPS is negative (a real alert); neutral otherwise so
 * `--danger` never decorates a neutral KPI. Null NPS stays neutral (no alert on
 * absent data).
 * @param nps - The NPS value, or null when unavailable.
 * @returns The colour token.
 */
export function npsColor(nps: number | null): KpiColor {
  if (nps !== null && nps < 0) return "var(--danger)";
  return "var(--ink-strong)";
}

/**
 * Computes the month-over-month volume delta as a percentage.
 * @param current - Current-month volume.
 * @param previous - Previous-month volume.
 * @returns The delta percent, or null when there is no comparable base (0).
 */
export function volumeDeltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Reads a defensively-typed NPS off a network aggregate.
 * The contract does not type NPS on the network aggregate, so the mock may or may
 * not provide it. Returns null when absent.
 * @param aggregate - The network aggregate.
 * @returns The NPS value, or null.
 */
function readNps(aggregate: NetworkAggregate): number | null {
  const nps = aggregate.nps;
  return typeof nps === "number" ? nps : null;
}

/**
 * Derives the exactly-3 COMEX KPIs from the current and previous network
 * aggregates. A missing previous aggregate yields null deltas (no invented
 * comparison). Null NPS and zero volume are flagged `partial` so the view can
 * annotate "données partielles" instead of showing a raw 0.
 * @param current - Current-period network aggregate.
 * @param previous - Previous-period network aggregate, or null when unavailable.
 * @param slaMinutes - Configured network SLA target (kept for callers deriving colour).
 * @returns The 3 KPIs.
 */
export function deriveComexKpis(
  current: NetworkAggregate,
  previous: NetworkAggregate | null,
  slaMinutes: number,
): ComexKpis {
  void slaMinutes;
  const nps = readNps(current);
  const prevNps = previous ? readNps(previous) : null;

  const volumeValue = current.totalTickets;
  const prevVolume = previous ? previous.totalTickets : null;

  return {
    nps: {
      value: nps,
      delta: nps !== null && prevNps !== null ? nps - prevNps : null,
      partial: nps === null,
    },
    tma: {
      value: current.avgTma,
      partial: false,
    },
    volume: {
      value: volumeValue,
      deltaPct: prevVolume !== null ? volumeDeltaPct(volumeValue, prevVolume) : null,
      partial: volumeValue === 0,
    },
  };
}
