/**
 * NOTIF-005-B — reactive online/offline status for the PWA.
 *
 * Wraps `navigator.onLine` + the `online`/`offline` window events so screens can
 * render the offline state (dernier état connu) and resync on reconnection.
 *
 * @module lib/pwa/use-network-status
 */
"use client";

import { useEffect, useState } from "react";

/**
 * Returns `true` while the browser reports a network connection.
 * SSR-safe: assumes online until the client hydrates.
 *
 * @returns Current online status.
 */
export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    // Sync once on mount in case status changed before listeners attached.
    setOnline(navigator.onLine);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
