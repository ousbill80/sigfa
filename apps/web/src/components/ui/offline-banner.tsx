/**
 * Offline banner — discrete notice shown when app is in offline mode.
 * @module components/ui/offline-banner
 */
"use client";

import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { OfflineBanner as UiOfflineBanner } from "@sigfa/ui";
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
    <UiOfflineBanner
      message={t("offline.banner")}
      style={{
        position: "fixed",
        bottom: "var(--space-4)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        boxShadow: "var(--shadow-2)",
      }}
    />
  );
}
