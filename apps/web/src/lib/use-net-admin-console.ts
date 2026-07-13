/**
 * use-net-admin-console — Super Admin network console workflow (NET-001-WEB).
 *
 * READ-ONLY cross-tenant supervision. The hook performs a SINGLE typed GET
 * through the @sigfa/contracts reporting client on the canonical LAW route:
 *   - GET /admin/network-overview   (SUPER_ADMIN, cross-tenant, allow-list)
 * There is NO mutation method here by design (hors-scope DÉFINITIF: aucune
 * écriture cross-tenant). Every response is passed through the client
 * allow-list (net-admin-allowlist) before it becomes a view model — double
 * defence: even a leaked PII field never reaches the UI.
 *
 * Offline: the last successfully sanitized view is kept frozen and a resync is
 * attempted on reconnection (5th state).
 * @module lib/use-net-admin-console
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import {
  sanitizeNetworkOverview,
  type NetworkOverviewView,
} from "./net-admin-allowlist";

/** Typed reporting client (network-overview lives here). */
export type ReportingClient = ReturnType<typeof createSigfaClient<"reporting">>;

/** Fetch lifecycle — the 5 console states. */
export type NetAdminLoad = "loading" | "ready" | "empty" | "error" | "offline";

/** Options for {@link useNetAdminConsole}. */
export interface UseNetAdminConsoleOptions {
  /** Reporting client (network-overview). */
  reporting: ReportingClient;
  /** Supervision period (ex. "2026-07"). */
  period: string;
}

/** Result of {@link useNetAdminConsole}. */
export interface UseNetAdminConsoleResult {
  /** Fetch lifecycle (one of the 5 states). */
  load: NetAdminLoad;
  /** Sanitized, render-safe view model (null until first success). */
  view: NetworkOverviewView | null;
  /** Fetches + sanitizes the cross-tenant overview (READ-ONLY). */
  refresh: () => Promise<void>;
  /** Marks the console offline — freezes the current view. */
  goOffline: () => void;
  /** Reconnects and resyncs (refresh) from the offline state. */
  resync: () => Promise<void>;
}

/**
 * Super Admin network console hook — read-only, allow-listed.
 * @param options - {@link UseNetAdminConsoleOptions}.
 * @returns {@link UseNetAdminConsoleResult}.
 */
export function useNetAdminConsole(
  options: UseNetAdminConsoleOptions,
): UseNetAdminConsoleResult {
  const { reporting, period } = options;
  const [load, setLoad] = useState<NetAdminLoad>("loading");
  const [view, setView] = useState<NetworkOverviewView | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoad("loading");
    try {
      const { data, error } = await reporting.GET("/admin/network-overview", {
        params: { query: { period } },
      });
      if (error || !data) {
        setLoad("error");
        return;
      }
      // DOUBLE DÉFENCE : la réponse passe par l'allow-list client avant l'UI.
      const sanitized = sanitizeNetworkOverview(data);
      setView(sanitized);
      setLoad(sanitized.banks.length === 0 ? "empty" : "ready");
    } catch {
      setLoad("error");
    }
  }, [reporting, period]);

  const goOffline = useCallback((): void => {
    setLoad("offline");
  }, []);

  const resync = useCallback(async (): Promise<void> => {
    await refresh();
  }, [refresh]);

  return useMemo(
    () => ({ load, view, refresh, goOffline, resync }),
    [load, view, refresh, goOffline, resync],
  );
}
