/**
 * useComexDashboard — COMEX quality dashboard workflow (WEB-005).
 *
 * KPIs come from the ONE canonical reporting route via the typed @sigfa/contracts
 * client: GET /reports/kpis?scope=network (contract reporting.yaml = the law).
 * The /reports/comex route is a REJECTED invention and is never requested. The
 * hook fetches the current period plus the previous period (for month-over-month
 * deltas) and derives exactly 3 KPIs (NPS, TMA, Volume). Realtime is simulated
 * (RT-001 owns the real socket; F4 convention = fixtures/simulated events).
 * @module lib/use-comex-dashboard
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { deriveComexKpis, type ComexKpis, type NetworkAggregate } from "./comex-state";

/** Typed reporting client (KPIs live here). */
export type ReportingClient = ReturnType<typeof createSigfaClient<"reporting">>;

/** Loading lifecycle of the dashboard fetch. */
export type ComexLoad = "loading" | "ready" | "empty" | "error";

/** Connection status driving the offline banner. */
export type ComexConnection = "connected" | "offline";

/** Options for {@link useComexDashboard}. */
export interface UseComexDashboardOptions {
  /** Reporting client (KPIs). */
  reporting: ReportingClient;
  /** Current analysis period (ex. "2026-07"). */
  period: string;
  /** Previous period for month-over-month deltas (ex. "2026-06"). */
  previousPeriod: string;
  /** Configured network SLA target in minutes. */
  slaMinutes: number;
}

/** Result of {@link useComexDashboard}. */
export interface UseComexDashboardResult {
  /** The derived 3 KPIs (null until fetched). */
  kpis: ComexKpis | null;
  /** Fetch lifecycle. */
  load: ComexLoad;
  /** Connection status. */
  connection: ComexConnection;
  /** Fetches the current + previous network aggregate from GET /reports/kpis?scope=network. */
  refresh: () => Promise<void>;
  /** Sets connection status (offline banner / resync). */
  setConnection: (status: ComexConnection) => void;
}

/** Raw network aggregate shape carried by the mock (NPS is optional per contract). */
interface RawAggregate {
  totalTickets?: unknown;
  avgTma?: unknown;
  avgTauxSLA?: unknown;
  agencyCount?: unknown;
  nps?: unknown;
}

/** Coerces a raw aggregate into a typed NetworkAggregate, or null when absent. */
function toAggregate(data: unknown): NetworkAggregate | null {
  const agg = (data as { aggregate?: RawAggregate } | null | undefined)?.aggregate;
  if (!agg || typeof agg !== "object") return null;
  return {
    avgTma: typeof agg.avgTma === "number" ? agg.avgTma : 0,
    totalTickets: typeof agg.totalTickets === "number" ? agg.totalTickets : 0,
    avgTauxSLA: typeof agg.avgTauxSLA === "number" ? agg.avgTauxSLA : 0,
    agencyCount: typeof agg.agencyCount === "number" ? agg.agencyCount : 0,
    nps: typeof agg.nps === "number" ? agg.nps : null,
  };
}

/**
 * COMEX quality dashboard hook.
 * @param options - {@link UseComexDashboardOptions}.
 * @returns {@link UseComexDashboardResult}.
 */
export function useComexDashboard(options: UseComexDashboardOptions): UseComexDashboardResult {
  const { reporting, period, previousPeriod, slaMinutes } = options;
  const [kpis, setKpis] = useState<ComexKpis | null>(null);
  const [load, setLoad] = useState<ComexLoad>("loading");
  const [connection, setConnectionState] = useState<ComexConnection>("connected");

  const refresh = useCallback(async (): Promise<void> => {
    setLoad("loading");
    try {
      // Canonical route ONLY, scope=network, for both current and previous month.
      const [cur, prev] = await Promise.all([
        reporting.GET("/reports/kpis", { params: { query: { scope: "network", period } } }),
        reporting.GET("/reports/kpis", { params: { query: { scope: "network", period: previousPeriod } } }),
      ]);

      if (cur.error || !cur.data) {
        setLoad("error");
        return;
      }

      const current = toAggregate(cur.data);
      if (!current) {
        setLoad("empty");
        return;
      }

      // Previous month is best-effort: its absence only drops the deltas.
      const previous = prev.error ? null : toAggregate(prev.data);

      setKpis(deriveComexKpis(current, previous, slaMinutes));
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }, [reporting, period, previousPeriod, slaMinutes]);

  const setConnection = useCallback((status: ComexConnection): void => {
    setConnectionState(status);
  }, []);

  return useMemo(
    () => ({ kpis, load, connection, refresh, setConnection }),
    [kpis, load, connection, refresh, setConnection],
  );
}
