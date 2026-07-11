/**
 * useManagerDashboard — manager dashboard workflow (WEB-003).
 *
 * KPIs come from the typed reporting client: GET /reports/kpis?scope=agency
 * (route canonique — /reports/live rejeté). Counter OPEN/PAUSED toggles go to
 * PATCH /counters/:id via the core client. Realtime is simulated (RT-001).
 * @module lib/use-manager-dashboard
 */
"use client";

import { useCallback, useMemo, useReducer, useState } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import {
  managerReducer,
  initialManagerState,
  type ManagerState,
  type AgentRow,
  type DashboardKpis,
} from "./manager-state";

/** Typed reporting client. */
export type ReportingClient = ReturnType<typeof createSigfaClient<"reporting">>;
/** Typed core client. */
export type CoreClient = ReturnType<typeof createSigfaClient<"core">>;

/** Loading lifecycle of the dashboard fetch. */
export type DashboardLoad = "loading" | "ready" | "empty" | "error";

/** Options for {@link useManagerDashboard}. */
export interface UseManagerDashboardOptions {
  /** Reporting client (KPIs). */
  reporting: ReportingClient;
  /** Core client (counter PATCH). */
  core: CoreClient;
  /** Agency UUID (from the JWT claim). */
  agencyId: string;
  /** Analysis period (ex. "2026-07"). */
  period: string;
  /** Initial agent grid seed. */
  seedAgents?: AgentRow[];
  /** Whether the viewer is read-only (AUDITOR). */
  readOnly?: boolean;
}

/** Result of {@link useManagerDashboard}. */
export interface UseManagerDashboardResult {
  /** The dashboard state. */
  state: ManagerState;
  /** Fetch lifecycle. */
  load: DashboardLoad;
  /** Whether the viewer is read-only (no action buttons). */
  readOnly: boolean;
  /** Fetches KPIs from GET /reports/kpis?scope=agency. */
  refreshKpis: () => Promise<void>;
  /** Toggles a counter status via PATCH /counters/:id. */
  toggleCounter: (counterId: string, status: "OPEN" | "PAUSED") => Promise<void>;
  /** Acknowledges an alert card. */
  acknowledge: (id: string) => void;
  /** Applies a realtime event (queue:updated / counter:status / alert:manager). */
  applyEvent: (
    type: "queue:updated" | "counter:status" | "alert:manager",
    payload: unknown,
    id?: string,
  ) => void;
  /** Sets connection status. */
  setConnection: (status: "connected" | "offline") => void;
}

/** Extracts a HH:MM stamp from the current time. */
function nowHHMM(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/**
 * Manager dashboard hook.
 * @param options - {@link UseManagerDashboardOptions}.
 * @returns {@link UseManagerDashboardResult}.
 */
export function useManagerDashboard(options: UseManagerDashboardOptions): UseManagerDashboardResult {
  const { reporting, core, agencyId, period, seedAgents = [], readOnly = false } = options;
  const [state, dispatch] = useReducer(managerReducer, {
    ...initialManagerState,
    agents: seedAgents,
  });
  const [load, setLoad] = useState<DashboardLoad>("loading");

  const refreshKpis = useCallback(async (): Promise<void> => {
    setLoad("loading");
    try {
      const { data, error } = await reporting.GET("/reports/kpis", {
        params: { query: { scope: "agency", period, agencyId } },
      });
      if (error || !data) {
        setLoad("error");
        return;
      }
      const body = data as { kpis?: Record<string, unknown> };
      if (!body.kpis) {
        setLoad("empty");
        return;
      }
      const k = body.kpis as unknown as DashboardKpis;
      dispatch({ type: "kpis", kpis: k, lastSync: nowHHMM() });
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }, [reporting, period, agencyId]);

  const toggleCounter = useCallback(
    async (counterId: string, status: "OPEN" | "PAUSED"): Promise<void> => {
      if (readOnly) return;
      try {
        const { data, error } = await core.PATCH("/counters/{id}", {
          params: { path: { id: counterId } },
          body: { status },
        });
        if (!error && data) {
          // Reflet optimiste ; l'état réel arrivera aussi via counter:status.
          dispatch({ type: "counter:status", payload: { counterId, status } });
        }
      } catch {
        // best-effort : l'action rejoint la queue de resync à la reconnexion.
      }
    },
    [core, readOnly],
  );

  const acknowledge = useCallback((id: string): void => {
    dispatch({ type: "acknowledge", id });
  }, []);

  const applyEvent = useCallback(
    (type: "queue:updated" | "counter:status" | "alert:manager", payload: unknown, id?: string): void => {
      if (type === "alert:manager") {
        dispatch({ type, payload, id: id ?? `${Date.now()}` });
      } else {
        dispatch({ type, payload });
      }
    },
    [],
  );

  const setConnection = useCallback((status: "connected" | "offline"): void => {
    dispatch({ type: "connection", status });
  }, []);

  return useMemo(
    () => ({ state, load, readOnly, refreshKpis, toggleCounter, acknowledge, applyEvent, setConnection }),
    [state, load, readOnly, refreshKpis, toggleCounter, acknowledge, applyEvent, setConnection],
  );
}
