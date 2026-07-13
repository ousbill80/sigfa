/**
 * Reporting surface state model (REP-003b).
 *
 * Pure, framework-free helpers for the export + benchmarking surface:
 *   - export job phase classification (PENDING/PROCESSING/READY/FAILED) and URL
 *     expiry detection (drives the "download" vs "restart" affordance);
 *   - benchmark status → design-system token mapping. The colour is DERIVED
 *     FROM THE SERVER STATUS ONLY (VERT/ORANGE/ROUGE/n/a) — the client NEVER
 *     re-categorises a KPI. `n/a` maps to `--info` (neutral), never `--danger`;
 *   - ordering that keeps the server rank but reliably relegates every `n/a`
 *     agency to the very end (an agency without data is never ranked as red).
 *
 * No file generation and no KPI computation happen here: everything is consumed
 * from the REP-003 contract (`@sigfa/contracts` reporting client). Tokens only.
 * @module lib/reports-state
 */
import type { TranslationKey } from "./i18n";

/** Export formats offered by REP-003 (`ExportFormat`). */
export const EXPORT_FORMATS = ["pdf", "xlsx", "json"] as const;
/** A single export format. */
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Export scopes offered by REP-003. */
export const EXPORT_SCOPES = ["agency", "network"] as const;
/** A single export scope. */
export type ExportScope = (typeof EXPORT_SCOPES)[number];

/** Export job lifecycle statuses (`ExportJobStatus`, DB-006 enum = law). */
export const EXPORT_STATUSES = ["PENDING", "PROCESSING", "READY", "FAILED"] as const;
/** A single export job status. */
export type ExportJobStatus = (typeof EXPORT_STATUSES)[number];

/** Sort KPIs accepted by `GET /reports/benchmark?sortKpi=` (CONTRACT-013). */
export const SORT_KPIS = [
  "tauxSLA",
  "tma",
  "tmt",
  "tts",
  "tauxAbandon",
  "nps",
  "occupation",
] as const;
/** A single sort KPI. */
export type SortKpi = (typeof SORT_KPIS)[number];

/** Server-owned benchmark status (`BenchmarkStatus`). */
export type BenchmarkStatus = "VERT" | "ORANGE" | "ROUGE" | "n/a";

/** i18n key for a sort KPI label. */
export function sortKpiLabelKey(kpi: SortKpi): TranslationKey {
  return `reports.kpi.${kpi}` as TranslationKey;
}

/** i18n key for an export format label. */
export function exportFormatLabelKey(format: ExportFormat): TranslationKey {
  return `reports.export.format.${format}` as TranslationKey;
}

/** i18n key for an export scope label. */
export function exportScopeLabelKey(scope: ExportScope): TranslationKey {
  return `reports.export.scope.${scope}` as TranslationKey;
}

/** i18n key for a live export job status label. */
export function exportStatusLabelKey(status: ExportJobStatus): TranslationKey {
  const map: Record<ExportJobStatus, TranslationKey> = {
    PENDING: "reports.export.status.pending",
    PROCESSING: "reports.export.status.processing",
    READY: "reports.export.status.ready",
    FAILED: "reports.export.status.failed",
  };
  return map[status];
}

/**
 * True while the job is still being produced (PENDING or PROCESSING) — the UI
 * keeps polling and shows the "generating" state.
 */
export function isJobInFlight(status: ExportJobStatus): boolean {
  return status === "PENDING" || status === "PROCESSING";
}

/**
 * True when the signed download URL has expired (`NOW() > expiresAt`). A missing
 * expiry is treated as NOT expired (the server owns freshness). Used to switch
 * from a live download link to a "restart export" affordance.
 * @param expiresAt - ISO-8601 expiry timestamp, or null/undefined.
 * @param now - Reference instant in ms (default: Date.now()).
 */
export function isDownloadExpired(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return false;
  return now > ts;
}

/**
 * True when the job is READY, has a signed URL and it has not expired — the only
 * case where the download button is live.
 */
export function canDownload(
  status: ExportJobStatus,
  downloadUrl: string | null | undefined,
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  return status === "READY" && !!downloadUrl && !isDownloadExpired(expiresAt, now);
}

/** Design-System functional token carried by a benchmark status pill. */
export type StatusToken =
  | "var(--success)"
  | "var(--warning)"
  | "var(--danger)"
  | "var(--info)";

/**
 * Maps a SERVER benchmark status to its design-system token. The mapping is a
 * pure translation of the server verdict — the client performs zero
 * re-categorisation. `n/a` → `--info` (neutral), NEVER `--danger`.
 * @param status - Server-provided benchmark status.
 * @returns The functional colour token.
 */
export function statusToken(status: BenchmarkStatus): StatusToken {
  switch (status) {
    case "VERT":
      return "var(--success)";
    case "ORANGE":
      return "var(--warning)";
    case "ROUGE":
      return "var(--danger)";
    case "n/a":
    default:
      return "var(--info)";
  }
}

/** i18n key for a benchmark status label. */
export function statusLabelKey(status: BenchmarkStatus): TranslationKey {
  switch (status) {
    case "VERT":
      return "reports.benchmark.status.vert";
    case "ORANGE":
      return "reports.benchmark.status.orange";
    case "ROUGE":
      return "reports.benchmark.status.rouge";
    case "n/a":
    default:
      return "reports.benchmark.status.na";
  }
}

/** A benchmark row consumed by the table (contract `BenchmarkEntry` subset). */
export interface BenchmarkRow {
  /** Rank as computed by the server. */
  rank: number;
  /** Agency UUID. */
  agencyId: string;
  /** Agency display name. */
  agencyName: string;
  /** Server-owned status pill. */
  status: BenchmarkStatus;
  /** SLA rate, percent. */
  tauxSLA: number;
  /** TMA, minutes. */
  tma: number;
}

/** Headline figures for the benchmark KpiTile overview row. */
export interface BenchmarkOverview {
  /** Number of ranked agencies (status ≠ n/a). */
  ranked: number;
  /** Best (rank 1) ranked agency name, or null when none. */
  best: string | null;
  /** Worst (last) ranked agency name, or null when none. */
  worst: string | null;
  /** Share of agencies without data (n/a), as an integer percent 0..100. */
  naSharePct: number;
}

/**
 * Derives the KpiTile overview from the already-ordered benchmark rows (ranked
 * first, n/a last — see {@link orderBenchmarkRows}). Pure aggregation, zero KPI
 * computation. The n/a share is a plain ratio of the total.
 * @param rows - Ordered benchmark rows.
 * @returns The {@link BenchmarkOverview}.
 */
export function benchmarkOverview(rows: readonly BenchmarkRow[]): BenchmarkOverview {
  const ranked = rows.filter((r) => r.status !== "n/a");
  const naCount = rows.length - ranked.length;
  const naSharePct = rows.length > 0 ? Math.round((naCount / rows.length) * 100) : 0;
  return {
    ranked: ranked.length,
    best: ranked[0]?.agencyName ?? null,
    worst: ranked.length > 0 ? (ranked[ranked.length - 1]?.agencyName ?? null) : null,
    naSharePct,
  };
}

/**
 * Formats the numeric value of the currently-sorted KPI for a benchmark row.
 * The contract's minimal `BenchmarkEntry` only carries `tauxSLA` (percent) and
 * `tma` (minutes); every other sort KPI is server-ranked without a per-row value
 * on this surface, so it returns null (rendered as a neutral dash — NEVER a
 * fabricated number). The client performs zero KPI computation.
 * @param row - The benchmark row.
 * @param sortKpi - The active sort KPI.
 * @returns A locale-agnostic formatted value, or null when unavailable.
 */
export function benchmarkValue(row: BenchmarkRow, sortKpi: SortKpi): string | null {
  switch (sortKpi) {
    case "tauxSLA":
      return `${row.tauxSLA} %`;
    case "tma":
      return `${row.tma} min`;
    default:
      return null;
  }
}

/**
 * Orders benchmark rows for display: ranked agencies keep the server order
 * (ascending rank), and every `n/a` agency is relegated to the end regardless of
 * its rank field — an agency without data is never shown as ranked/red.
 * @param rows - Raw rows from the benchmark response.
 * @returns A new, ordered array (input untouched).
 */
export function orderBenchmarkRows(rows: readonly BenchmarkRow[]): BenchmarkRow[] {
  const ranked = rows.filter((r) => r.status !== "n/a").sort((a, b) => a.rank - b.rank);
  const na = rows.filter((r) => r.status === "n/a");
  return [...ranked, ...na];
}
