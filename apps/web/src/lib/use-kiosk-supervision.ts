/**
 * useKioskSupervision — kiosk supervision workflow (ADM-003b).
 *
 * Feeds the supervision screen from the CANONICAL contract route
 * GET /agencies/{id}/kiosks/status (mapped to SupervisedKiosk rows) and keeps it
 * live through three converging mechanisms:
 *   - realtime: subscribes to kiosk:silent / kiosk:recovered / kiosk:status on
 *     the injected socket (SocketProvider surface) — payloads are contract-
 *     validated inside the reducer;
 *   - poll fallback: when no socket is connected (mock / socket down), it re-reads
 *     .../status on a short interval so the screen never goes stale;
 *   - resync: on (re)connect the socket fires `connect`/`reconnect`, which triggers
 *     a full re-read → state convergence (snapshot, never a replay).
 * The hook owns no wall clock beyond the poll timer; time formatting is done by
 * the pure helpers (injected clock). Realtime is off in mock mode (RT-001 owns
 * the real socket); the poll keeps the mock surface fresh.
 * @module lib/use-kiosk-supervision
 */
"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  kioskSupervisionReducer,
  initialKioskSupervisionState,
  type KioskSupervisionState,
  type SupervisedKiosk,
  type KioskStatus,
} from "./kiosk-supervision-state";

/** Loading lifecycle of the supervision fetch. */
export type SupervisionLoad = "loading" | "ready" | "empty" | "error" | "stale";

/** Raw kiosk status entry from GET .../kiosks/status (defensive shape). */
export interface RawKioskEntry {
  /** Kiosk UUID. */
  kioskId?: unknown;
  /** Agency UUID. */
  agencyId?: unknown;
  /** Supervision status. */
  status?: unknown;
  /** Last heartbeat ISO timestamp (nullable). */
  lastSeen?: unknown;
}

/** Minimal socket surface consumed by the hook (subset of socket.io Socket). */
export interface SupervisionSocket {
  /** True when the socket is connected. */
  connected: boolean;
  /** Registers an event listener. */
  on: (event: string, listener: (payload: unknown) => void) => void;
  /** Removes an event listener. */
  off: (event: string, listener: (payload: unknown) => void) => void;
}

/** Default poll interval when no live socket is available (ms). */
export const DEFAULT_POLL_MS = 10_000;

const KIOSK_STATUSES: readonly KioskStatus[] = ["ONLINE", "DEGRADED", "SILENT", "NEVER_SEEN"];

/**
 * Coerces a raw status entry into a SupervisedKiosk, or null when malformed.
 * @param raw - Raw entry from the status route.
 * @returns A SupervisedKiosk or null.
 */
export function toSupervisedKiosk(raw: RawKioskEntry): SupervisedKiosk | null {
  if (typeof raw.kioskId !== "string" || typeof raw.agencyId !== "string") return null;
  if (typeof raw.status !== "string" || !KIOSK_STATUSES.includes(raw.status as KioskStatus)) {
    return null;
  }
  return {
    kioskId: raw.kioskId,
    agencyId: raw.agencyId,
    status: raw.status as KioskStatus,
    lastSeen: typeof raw.lastSeen === "string" ? raw.lastSeen : null,
  };
}

/** Options for {@link useKioskSupervision}. */
export interface UseKioskSupervisionOptions {
  /**
   * Reads the current kiosk status list (wraps the contract route). Returning
   * `null` signals a fetch error (banner + last known state). Must be stable.
   */
  fetchStatus: () => Promise<RawKioskEntry[] | null>;
  /** Live socket (SocketProvider). Absent/undefined → poll-only (mock). */
  socket?: SupervisionSocket | null;
  /** Poll interval in ms (default {@link DEFAULT_POLL_MS}). */
  pollMs?: number;
}

/** Result of {@link useKioskSupervision}. */
export interface UseKioskSupervisionResult {
  /** The supervision state (kiosks + connection). */
  state: KioskSupervisionState;
  /** Fetch lifecycle. */
  load: SupervisionLoad;
  /** Re-reads the status route and reseeds the state (also used for resync). */
  refresh: () => Promise<void>;
}

/**
 * Kiosk supervision hook — status fetch + realtime + poll fallback + resync.
 * @param options - {@link UseKioskSupervisionOptions}.
 * @returns {@link UseKioskSupervisionResult}.
 */
export function useKioskSupervision(
  options: UseKioskSupervisionOptions,
): UseKioskSupervisionResult {
  const { fetchStatus, socket = null, pollMs = DEFAULT_POLL_MS } = options;
  const [state, dispatch] = useReducer(kioskSupervisionReducer, initialKioskSupervisionState);
  const [load, setLoad] = useState<SupervisionLoad>("loading");
  // Keeps `load` visible to the poll callback without re-subscribing the timer.
  const loadedOnceRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const rows = await fetchStatus();
      if (rows === null) {
        // Route unavailable: keep last known state, surface a "stale" banner.
        setLoad(loadedOnceRef.current ? "stale" : "error");
        return;
      }
      const kiosks = rows
        .map(toSupervisedKiosk)
        .filter((k): k is SupervisedKiosk => k !== null);
      dispatch({ type: "seed", kiosks });
      loadedOnceRef.current = true;
      setLoad(kiosks.length === 0 ? "empty" : "ready");
    } catch {
      setLoad(loadedOnceRef.current ? "stale" : "error");
    }
  }, [fetchStatus]);

  // Initial load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime: subscribe to the three supervision events + resync on (re)connect.
  useEffect(() => {
    if (!socket) {
      dispatch({ type: "connection", status: "offline" });
      return;
    }

    const onSilent = (payload: unknown): void => dispatch({ type: "kiosk:silent", payload });
    const onRecovered = (payload: unknown): void => dispatch({ type: "kiosk:recovered", payload });
    const onStatus = (payload: unknown): void => dispatch({ type: "kiosk:status", payload });
    const onConnect = (): void => {
      dispatch({ type: "connection", status: "connected" });
      // Resync: full snapshot re-read on (re)connect (convergence, not replay).
      void refresh();
    };
    const onDisconnect = (): void => dispatch({ type: "connection", status: "offline" });

    socket.on("kiosk:silent", onSilent);
    socket.on("kiosk:recovered", onRecovered);
    socket.on("kiosk:status", onStatus);
    socket.on("connect", onConnect);
    socket.on("reconnect", onConnect);
    socket.on("disconnect", onDisconnect);

    dispatch({ type: "connection", status: socket.connected ? "connected" : "offline" });

    return () => {
      socket.off("kiosk:silent", onSilent);
      socket.off("kiosk:recovered", onRecovered);
      socket.off("kiosk:status", onStatus);
      socket.off("connect", onConnect);
      socket.off("reconnect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket, refresh]);

  // Poll fallback: only while no live socket is connected (mock / socket down).
  useEffect(() => {
    if (socket?.connected) return;
    const id = setInterval(() => {
      void refresh();
    }, pollMs);
    return () => clearInterval(id);
  }, [socket, pollMs, refresh]);

  return useMemo(() => ({ state, load, refresh }), [state, load, refresh]);
}
