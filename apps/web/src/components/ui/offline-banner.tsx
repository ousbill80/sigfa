/**
 * Offline banner — discrete notice shown when app is in offline mode.
 * @module components/ui/offline-banner
 */
"use client";

import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";

/** Offline banner component */
export function OfflineBanner(): ReactElement | null {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    function handleOffline(): void {
      setIsOffline(true);
    }
    function handleOnline(): void {
      setIsOffline(false);
    }

    // Check initial state
    if (!navigator.onLine) {
      setIsOffline(true);
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "1rem",
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: "var(--warning)",
        color: "var(--ink-strong)",
        padding: "0.5rem 1rem",
        borderRadius: "0.5rem",
        fontSize: "0.875rem",
        fontWeight: "500",
        zIndex: 9999,
        boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
      }}
    >
      {t("offline.banner")}
    </div>
  );
}
