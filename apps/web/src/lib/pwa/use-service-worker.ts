/**
 * NOTIF-005-B — registers the PWA service worker (offline / light resync).
 *
 * The SW (`/pwa-sw.js`) caches the app shell + revalidates the public tracking
 * endpoint (Cache-Control: max-age=30) so a flaky network still shows a recent
 * ticket state. Registration is best-effort: absence of `serviceWorker` (or a
 * failed registration) never breaks the page — it just stays online-only.
 *
 * @module lib/pwa/use-service-worker
 */
"use client";

import { useEffect } from "react";

/** Path of the service worker script served from `public/`. */
export const SERVICE_WORKER_PATH = "/pwa-sw.js";

/**
 * Registers the PWA service worker on mount (browser only).
 *
 * @param enabled - Gate registration (default `true`; tests pass `false`).
 */
export function useServiceWorker(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    // Register after load so it never competes with first paint.
    navigator.serviceWorker
      .register(SERVICE_WORKER_PATH, { scope: "/q/" })
      .catch(() => {
        // Best-effort: offline support is progressive enhancement.
      });
    return () => {
      cancelled = true;
      void cancelled;
    };
  }, [enabled]);
}
