/**
 * useBenchmark — inter-agency benchmarking workflow (REP-003b).
 *
 * Consumes ONLY GET /reports/benchmark from the REP-003 contract (typed
 * @sigfa/contracts reporting client). The server owns the colour verdict
 * (VERT/ORANGE/ROUGE/n/a); the client performs ZERO re-categorisation — it only
 * maps the status to a token (reports-state.statusToken) and relegates every
 * `n/a` agency to the end (orderBenchmarkRows). `sortKpi` is forwarded to the
 * server, which re-ranks. Rows are filtered to the viewer's JWT bankId (RBAC).
 * Drives the 4 fetch states (loading/ready/empty/error) plus an offline flag.
 * @module lib/use-benchmark
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import type { ReportingClient } from "./use-report-export";
import {
  orderBenchmarkRows,
  type BenchmarkRow,
  type BenchmarkStatus,
  type SortKpi,
} from "./reports-state";

/** Fetch lifecycle of the benchmark. */
export type BenchmarkLoad = "loading" | "ready" | "empty" | "error";

/** Options for {@link useBenchmark}. */
export interface UseBenchmarkOptions {
  /** Typed reporting client. */
  reporting: ReportingClient;
  /** Bank UUID (from the JWT claim) — filters the ranking to the perimeter. */
  bankId: string;
  /** Analysis period (ex. "2026-07"). */
  period: string;
}

/** Result of {@link useBenchmark}. */
export interface UseBenchmarkResult {
  /** Ordered rows (ranked first, n/a last). */
  rows: BenchmarkRow[];
  /** Fetch lifecycle. */
  load: BenchmarkLoad;
  /** Current sort KPI. */
  sortKpi: SortKpi;
  /** Fetches the benchmark for a given sort KPI. */
  refresh: (sortKpi?: SortKpi) => Promise<void>;
}

/** Raw benchmark row (contract fields + tenant carried by the mock). */
interface RawBenchmarkEntry {
  rank?: unknown;
  agencyId?: unknown;
  agencyName?: unknown;
  bankId?: unknown;
  status?: unknown;
  tauxSLA?: unknown;
  tma?: unknown;
}

/** Valid contract statuses. */
const STATUSES: readonly BenchmarkStatus[] = ["VERT", "ORANGE", "ROUGE", "n/a"];

/** Coerces an unknown status into a valid BenchmarkStatus (defaults n/a). */
function toStatus(value: unknown): BenchmarkStatus {
  return STATUSES.includes(value as BenchmarkStatus) ? (value as BenchmarkStatus) : "n/a";
}

/** Maps a raw entry to a BenchmarkRow (defensive coercion), or null. */
function toRow(raw: RawBenchmarkEntry): BenchmarkRow | null {
  if (typeof raw.agencyId !== "string" || typeof raw.agencyName !== "string") return null;
  return {
    rank: typeof raw.rank === "number" ? raw.rank : 0,
    agencyId: raw.agencyId,
    agencyName: raw.agencyName,
    status: toStatus(raw.status),
    tauxSLA: typeof raw.tauxSLA === "number" ? raw.tauxSLA : 0,
    tma: typeof raw.tma === "number" ? raw.tma : 0,
  };
}

/**
 * Inter-agency benchmarking hook.
 * @param options - {@link UseBenchmarkOptions}.
 * @returns {@link UseBenchmarkResult}.
 */
export function useBenchmark(options: UseBenchmarkOptions): UseBenchmarkResult {
  const { reporting, bankId, period } = options;
  const [rows, setRows] = useState<BenchmarkRow[]>([]);
  const [load, setLoad] = useState<BenchmarkLoad>("loading");
  const [sortKpi, setSortKpi] = useState<SortKpi>("tauxSLA");

  const refresh = useCallback(
    async (nextSort?: SortKpi): Promise<void> => {
      const sort = nextSort ?? sortKpi;
      setSortKpi(sort);
      setLoad("loading");
      try {
        const res = await reporting.GET("/reports/benchmark", {
          params: { query: { period, sortKpi: sort } },
        });
        if (res.error || !res.data) {
          setLoad("error");
          return;
        }
        const body = res.data as { data?: RawBenchmarkEntry[] };
        const raw = Array.isArray(body.data) ? body.data : [];
        const mapped = raw
          // RBAC: keep only rows within the viewer's bankId. Rows without a
          // bankId (contract minimal shape) are kept as in-scope.
          .filter((r) => r.bankId === undefined || r.bankId === bankId)
          .map(toRow)
          .filter((r): r is BenchmarkRow => r !== null);

        if (mapped.length === 0) {
          setRows([]);
          setLoad("empty");
          return;
        }
        setRows(orderBenchmarkRows(mapped));
        setLoad("ready");
      } catch {
        setLoad("error");
      }
    },
    [reporting, period, bankId, sortKpi],
  );

  return useMemo(
    () => ({ rows, load, sortKpi, refresh }),
    [rows, load, sortKpi, refresh],
  );
}
