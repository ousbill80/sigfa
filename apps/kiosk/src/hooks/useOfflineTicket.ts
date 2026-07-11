/**
 * KIOSK-004 — useOfflineTicket hook stub
 * Creates a local ticket when the network is unavailable.
 */
"use client";

export interface OfflineTicketResult {
  trackingId: string;
  displayNumber: string;
  position: number;
  estimatedWaitMinutes: number;
  isOffline: true;
}

export function useOfflineTicket() {
  const createOfflineTicket = async (): Promise<OfflineTicketResult> => {
    return {
      trackingId: `offline-${Date.now()}`,
      displayNumber: `H${String(Math.floor(Math.random() * 999)).padStart(3, "0")}`,
      position: 1,
      estimatedWaitMinutes: 0,
      isOffline: true as const,
    };
  };
  return { createOfflineTicket };
}
