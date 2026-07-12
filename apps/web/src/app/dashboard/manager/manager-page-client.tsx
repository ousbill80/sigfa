/**
 * Manager dashboard client shell (WEB-003) — S3 (Boucle 2 F4).
 *
 * apiBase et agencyId arrivent en PROPS depuis le server component (proxy
 * /api/rt + claims du JWT vérifié en mode real ; mock Prism + fixture sinon).
 * RBAC MANAGER/AUDITOR enforced by middleware (WEB-001). AUDITOR read-only.
 * KPIs from GET /reports/kpis?scope=agency.
 * @module app/dashboard/manager/manager-page-client
 */
"use client";

import type { ReactElement } from "react";
import { useEffect, useMemo } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { ManagerDashboard } from "@/components/manager/manager-dashboard";
import { useManagerDashboard } from "@/lib/use-manager-dashboard";
import type { AgentRow } from "@/lib/manager-state";
import { OfflineBanner } from "@/components/ui/offline-banner";

/** Period (would come from the date). */
const PERIOD = "2026-07";

/** Seed agent grid (would come from GET /counters). */
const SEED_AGENTS: AgentRow[] = [
  { counterId: "c1", label: "Guichet 1", agentName: "Koné A.", status: "OPEN", ticketNumber: "A047", alerted: false },
  { counterId: "c2", label: "Guichet 2", agentName: "Traoré K.", status: "PAUSED", ticketNumber: null, alerted: false },
];

/** Placeholder 24h TMA series (would come from the reporting timeseries). */
const TMA_SERIES = Array.from({ length: 24 }, (_, i) => 8 + Math.round(6 * Math.sin(i / 3)));

/** Props dérivées côté serveur (S3). */
export interface ManagerPageClientProps {
  /** Base API : /api/rt en mode real, mock Prism sinon. */
  apiBase: string;
  /** Agence du scope JWT vérifié (ou fixture mock). */
  agencyId: string;
}

/**
 * Manager dashboard client shell.
 * @param props - {@link ManagerPageClientProps}.
 * @returns The dashboard element.
 */
export function ManagerPageClient({ apiBase, agencyId }: ManagerPageClientProps): ReactElement {
  const reporting = useMemo(() => createSigfaClient("reporting", apiBase), [apiBase]);
  const core = useMemo(() => createSigfaClient("core", apiBase), [apiBase]);
  const dash = useManagerDashboard({
    reporting,
    core,
    agencyId,
    period: PERIOD,
    seedAgents: SEED_AGENTS,
  });

  useEffect(() => {
    void dash.refreshKpis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <ManagerDashboard
        state={dash.state}
        load={dash.load}
        readOnly={dash.readOnly}
        tmaSeries={TMA_SERIES}
        tmaDeltaJ7={-2}
        onToggleCounter={(id, status) => void dash.toggleCounter(id, status)}
        onAcknowledge={dash.acknowledge}
      />
      <OfflineBanner />
    </>
  );
}
