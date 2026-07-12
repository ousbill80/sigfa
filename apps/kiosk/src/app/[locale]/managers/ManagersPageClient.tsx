/**
 * MODEL-KIOSK-B — ManagersPageClient
 * Résout l'`agencyId` (session borne, sinon défaut démo) pour l'écran conseillers.
 * Wrapper client chargé sans SSR (parité avec l'écran opérations, export statique).
 */
"use client";

import { getKioskSession } from "@/lib/kiosk-session-store";
import { ManagersScreen } from "@/components/ManagersScreen";

/** Agence par défaut en démo/dev (parité avec la page services). */
const DEFAULT_AGENCY_ID = "agt-001";

export function ManagersPageClient() {
  const agencyId = getKioskSession()?.agencyId ?? DEFAULT_AGENCY_ID;
  return <ManagersScreen agencyId={agencyId} />;
}
