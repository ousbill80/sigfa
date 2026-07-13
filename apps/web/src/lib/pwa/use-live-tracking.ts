/**
 * NOTIF-005-B — live tracking of a ticket by trackingId (polling + offline).
 *
 * Polls `GET /public/tickets/{trackingId}` on an interval aligned with the
 * contract cache window (`Cache-Control: max-age=30`, CONTRACT-003). While the
 * browser is offline it keeps the last known state (dernier état connu) and
 * resumes polling on reconnection. Never throws to the UI — exposes a status.
 *
 * @module lib/pwa/use-live-tracking
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trackTicket, type PublicTicketStatus } from "./pwa-client";
import { useNetworkStatus } from "./use-network-status";

/** Poll cadence — matches the contract cache window (max-age=30). */
export const POLL_INTERVAL_MS = 30_000;

/** Terminal statuses where polling should stop. */
const TERMINAL: ReadonlySet<string> = new Set(["DONE", "NO_SHOW", "ABANDONED"]);

/** UI phase of the live-tracking surface (drives the 5 design states). */
export type TrackingPhase = "loading" | "ready" | "error" | "offline";

/** Return shape of {@link useLiveTracking}. */
export interface LiveTracking {
  readonly ticket: PublicTicketStatus | null;
  readonly phase: TrackingPhase;
  /** Manual refresh (also used by the error-state retry action). */
  readonly refresh: () => void;
}

/**
 * Subscribes to a ticket's public status.
 *
 * @param baseUrl - Public API base URL.
 * @param trackingId - nanoid(21) tracking id (null disables the hook).
 * @param intervalMs - Poll cadence (default {@link POLL_INTERVAL_MS}).
 * @returns The last known ticket, current phase, and a manual refresh.
 */
export function useLiveTracking(
  baseUrl: string,
  trackingId: string | null,
  intervalMs: number = POLL_INTERVAL_MS,
): LiveTracking {
  const online = useNetworkStatus();
  const [ticket, setTicket] = useState<PublicTicketStatus | null>(null);
  const [phase, setPhase] = useState<TrackingPhase>("loading");
  // Ref mirror so the interval callback reads the latest ticket without
  // re-arming the timer on every state change.
  const ticketRef = useRef<PublicTicketStatus | null>(null);
  ticketRef.current = ticket;

  const load = useCallback(async () => {
    if (!trackingId) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      // Keep last known state; surface offline only once we have something.
      setPhase(ticketRef.current ? "offline" : "loading");
      return;
    }
    const res = await trackTicket(baseUrl, trackingId);
    if (res.ok) {
      setTicket(res.data);
      setPhase("ready");
    } else if (!ticketRef.current) {
      // First load failed and nothing cached → error state.
      setPhase("error");
    }
    // If a later poll fails but we have a cached ticket, keep showing it.
  }, [baseUrl, trackingId]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  // Initial load + poll loop. Stops on terminal status or when disabled.
  useEffect(() => {
    if (!trackingId) return;
    void load();
    const timer = setInterval(() => {
      const current = ticketRef.current;
      if (current && TERMINAL.has(current.status)) return;
      void load();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [trackingId, intervalMs, load]);

  // Resync immediately on reconnection.
  useEffect(() => {
    if (online && trackingId) void load();
    if (!online && ticketRef.current) setPhase("offline");
  }, [online, trackingId, load]);

  return { ticket, phase, refresh };
}
