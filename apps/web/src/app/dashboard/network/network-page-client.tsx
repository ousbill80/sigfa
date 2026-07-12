/**
 * Network direction dashboard client shell (WEB-004) — S3 (Boucle 2 F4).
 *
 * apiBase et bankId arrivent en PROPS depuis le server component (proxy
 * /api/rt + claims du JWT vérifié en mode real ; mock Prism + fixture sinon).
 * RBAC BANK_ADMIN / AGENCY_DIRECTOR enforced by middleware (WEB-001).
 * Data from GET /reports/benchmark + GET /admin/network-overview.
 * @module app/dashboard/network/network-page-client
 */
"use client";

import type { ReactElement } from "react";
import { useEffect, useMemo } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { NetworkDashboard } from "@/components/network/network-dashboard";
import { useNetworkDashboard } from "@/lib/use-network-dashboard";
import { OfflineBanner } from "@/components/ui/offline-banner";

/** Period + SLA (would come from the date / bank config). */
const PERIOD = "2026-07";
const SLA_MINUTES = 15;

/** Props dérivées côté serveur (S3). */
export interface NetworkPageClientProps {
  /** Base API : /api/rt en mode real, mock Prism sinon. */
  apiBase: string;
  /** Banque du JWT vérifié (ou fixture mock). */
  bankId: string;
}

/**
 * Network direction dashboard client shell.
 * @param props - {@link NetworkPageClientProps}.
 * @returns The dashboard element.
 */
export function NetworkPageClient({ apiBase, bankId }: NetworkPageClientProps): ReactElement {
  const reporting = useMemo(() => createSigfaClient("reporting", apiBase), [apiBase]);
  const dash = useNetworkDashboard({ reporting, bankId, period: PERIOD, slaMinutes: SLA_MINUTES });

  useEffect(() => {
    void dash.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <NetworkDashboard state={dash.state} load={dash.load} slaMinutes={SLA_MINUTES} overview={dash.overview} />
      <OfflineBanner />
    </>
  );
}
