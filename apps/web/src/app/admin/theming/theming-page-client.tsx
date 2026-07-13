/**
 * Theming console client shell (ADM-001b).
 *
 * Wires the typed @sigfa/contracts `admin` client (mock Prism / same-origin
 * /api/rt proxy) to the ThemingConsole via the useAdmTheme workflow hook. The
 * tenant context (bankId, role, apiBase) arrives in PROPS from the server
 * component — no tenant constants nor direct NEXT_PUBLIC_API_URL access client
 * side. Connectivity changes flip the console to its offline state without a
 * page reload.
 *
 * @module app/admin/theming/theming-page-client
 */
"use client";

import { useEffect, useMemo, type ReactElement } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { ThemingConsole } from "@/components/admin/theming-console";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { useAdmTheme } from "@/lib/use-adm-theme";
import type { Role } from "@/lib/roles";

/** Props derived server side (never tenant constants client side). */
export interface ThemingPageClientProps {
  /** Base API: /api/rt in real mode, mock Prism otherwise. */
  apiBase: string;
  /** Bank of the verified JWT (or mock fixture). */
  bankId: string;
  /** Role of the verified JWT (or mock fixture). */
  role: Role;
}

/**
 * Theming console client shell.
 * @param props - {@link ThemingPageClientProps}.
 * @returns The console element.
 */
export function ThemingPageClient({ apiBase, bankId, role }: ThemingPageClientProps): ReactElement {
  const admin = useMemo(() => createSigfaClient("admin", apiBase), [apiBase]);
  const { status, theme, setOffline, reload, saveTheme, uploadLogo } = useAdmTheme({ admin, bankId });

  // Reflect connectivity into the console without a page reload.
  useEffect(() => {
    const onOffline = (): void => setOffline(true);
    const onOnline = (): void => {
      setOffline(false);
      void reload();
    };
    if (typeof navigator !== "undefined" && !navigator.onLine) setOffline(true);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [setOffline, reload]);

  return (
    <>
      <ThemingConsole
        role={role}
        status={status}
        theme={theme}
        onSave={saveTheme}
        onUploadLogo={uploadLogo}
        onRetry={() => void reload()}
      />
      <OfflineBanner />
    </>
  );
}
