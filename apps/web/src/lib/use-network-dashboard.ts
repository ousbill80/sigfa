/**
 * useNetworkDashboard — network direction dashboard workflow (WEB-004).
 *
 * Aggregates the two CANONICAL reporting routes via the typed @sigfa/contracts
 * client:
 *   - GET /reports/benchmark          (per-agency ranking, badge colours)
 *   - GET /admin/network-overview     (network aggregate KPIs)
 * The route /reports/network is a REJECTED invention and is never requested.
 * Rows are filtered to the viewer's JWT bankId (RBAC), sorted TMA-desc, and the
 * two simulated realtime events (agency:offline / alert:manager) are applied
 * through the network reducer. Realtime is simulated (RT-001 owns the real
 * socket; F4 convention = fixtures).
 * @module lib/use-network-dashboard
 */
"use client";

import { useCallback, useMemo, useReducer, useState } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import {
  networkReducer,
  initialNetworkState,
  type NetworkAgency,
  type NetworkState,
} from "./network-state";

/** Typed reporting client (benchmark + network-overview live here). */
export type ReportingClient = ReturnType<typeof createSigfaClient<"reporting">>;

/** Loading lifecycle of the dashboard fetch. */
export type NetworkLoad = "loading" | "ready" | "empty" | "error";

/** Network aggregate KPIs from GET /admin/network-overview. */
export interface NetworkOverview {
  /** Number of agencies in the aggregate. */
  agencyCount: number;
  /** Network average TMA, minutes. */
  avgTma: number;
  /** Network average SLA rate, percent. */
  avgTauxSLA: number;
}

/** Options for {@link useNetworkDashboard}. */
export interface UseNetworkDashboardOptions {
  /** Reporting client (benchmark + network-overview). */
  reporting: ReportingClient;
  /** Bank UUID (from the JWT claim) — filters the ranking to the perimeter. */
  bankId: string;
  /** Analysis period (ex. "2026-07"). */
  period: string;
  /** Configured SLA target in minutes for the badges. */
  slaMinutes: number;
}

/** Result of {@link useNetworkDashboard}. */
export interface UseNetworkDashboardResult {
  /** The dashboard state. */
  state: NetworkState;
  /** Fetch lifecycle. */
  load: NetworkLoad;
  /** Network aggregate KPIs (null until fetched). */
  overview: NetworkOverview | null;
  /** Fetches benchmark + network-overview and seeds the ranking. */
  refresh: () => Promise<void>;
  /** Applies a simulated agency:offline event. */
  applyOffline: (payload: unknown) => void;
  /** Applies a simulated alert:manager event from a given agency. */
  applyAlert: (agencyId: string, payload: unknown, id: string) => void;
  /** Sets connection status (offline badge / resync). */
  setConnection: (status: "connected" | "offline") => void;
}

/** Raw benchmark row (contract fields + tenant/city carried by the mock). */
interface RawBenchmarkEntry {
  agencyId?: unknown;
  agencyName?: unknown;
  bankId?: unknown;
  city?: unknown;
  tma?: unknown;
  tauxSLA?: unknown;
}

/** Maps a raw benchmark entry to a NetworkAgency (defensive coercion). */
function toAgency(raw: RawBenchmarkEntry): NetworkAgency | null {
  if (typeof raw.agencyId !== "string" || typeof raw.agencyName !== "string") return null;
  return {
    agencyId: raw.agencyId,
    agencyName: raw.agencyName,
    city: typeof raw.city === "string" ? raw.city : "",
    tma: typeof raw.tma === "number" ? raw.tma : 0,
    tauxSLA: typeof raw.tauxSLA === "number" ? raw.tauxSLA : 0,
    offline: false,
  };
}

/**
 * Network direction dashboard hook.
 * @param options - {@link UseNetworkDashboardOptions}.
 * @returns {@link UseNetworkDashboardResult}.
 */
export function useNetworkDashboard(options: UseNetworkDashboardOptions): UseNetworkDashboardResult {
  const { reporting, bankId, period, slaMinutes } = options;
  const [state, dispatch] = useReducer(networkReducer, { ...initialNetworkState, slaMinutes });
  const [load, setLoad] = useState<NetworkLoad>("loading");
  const [overview, setOverview] = useState<NetworkOverview | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoad("loading");
    try {
      const [bench, net] = await Promise.all([
        reporting.GET("/reports/benchmark", { params: { query: { period } } }),
        reporting.GET("/admin/network-overview", { params: { query: { period } } }),
      ]);

      if (bench.error || !bench.data) {
        setLoad("error");
        return;
      }

      const body = bench.data as { data?: RawBenchmarkEntry[] };
      const rows = Array.isArray(body.data) ? body.data : [];
      const agencies = rows
        // RBAC: keep only agencies within the viewer's bankId perimeter.
        // Rows without a bankId (contract minimal shape) are kept as in-scope.
        .filter((r) => r.bankId === undefined || r.bankId === bankId)
        .map(toAgency)
        .filter((a): a is NetworkAgency => a !== null);

      if (net.data) {
        const agg = (net.data as { aggregate?: { agencyCount?: number; avgTma?: number; avgTauxSLA?: number } }).aggregate;
        if (agg) {
          setOverview({
            agencyCount: agg.agencyCount ?? 0,
            avgTma: agg.avgTma ?? 0,
            avgTauxSLA: agg.avgTauxSLA ?? 0,
          });
        }
      }

      if (agencies.length === 0) {
        setLoad("empty");
        return;
      }

      dispatch({ type: "seed", agencies, slaMinutes });
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }, [reporting, period, bankId, slaMinutes]);

  const applyOffline = useCallback((payload: unknown): void => {
    dispatch({ type: "agency:offline", payload });
  }, []);

  const applyAlert = useCallback((agencyId: string, payload: unknown, id: string): void => {
    dispatch({ type: "alert:manager", payload, agencyId, id });
  }, []);

  const setConnection = useCallback((status: "connected" | "offline"): void => {
    dispatch({ type: "connection", status });
  }, []);

  return useMemo(
    () => ({ state, load, overview, refresh, applyOffline, applyAlert, setConnection }),
    [state, load, overview, refresh, applyOffline, applyAlert, setConnection],
  );
}
