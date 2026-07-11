/**
 * Manager dashboard page (WEB-003).
 * RBAC MANAGER/AUDITOR enforced by middleware (WEB-001). AUDITOR is read-only.
 * KPIs from GET /reports/kpis?scope=agency. Realtime simulated (RT-001).
 * @module app/dashboard/manager/page
 */
"use client";

import type { ReactElement } from "react";
import { useEffect, useMemo } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { ManagerDashboard } from "@/components/manager/manager-dashboard";
import { useManagerDashboard } from "@/lib/use-manager-dashboard";
import type { AgentRow } from "@/lib/manager-state";
import { OfflineBanner } from "@/components/ui/offline-banner";

/** Prism mock base URL (RT-001 keeps the real socket inactive). */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";

/** Agency + period (would come from the JWT claim / date). */
const AGENCY_ID = "33333333-3333-4333-a333-333333333333";
const PERIOD = "2026-07";

/** Seed agent grid (would come from GET /counters). */
const SEED_AGENTS: AgentRow[] = [
  { counterId: "c1", label: "Guichet 1", agentName: "Koné A.", status: "OPEN", ticketNumber: "A047", alerted: false },
  { counterId: "c2", label: "Guichet 2", agentName: "Traoré K.", status: "PAUSED", ticketNumber: null, alerted: false },
];

/** Placeholder 24h TMA series (would come from the reporting timeseries). */
const TMA_SERIES = Array.from({ length: 24 }, (_, i) => 8 + Math.round(6 * Math.sin(i / 3)));

/**
 * Manager dashboard route page.
 * @returns The page element.
 */
export default function ManagerDashboardPage(): ReactElement {
  const reporting = useMemo(() => createSigfaClient("reporting", API_BASE), []);
  const core = useMemo(() => createSigfaClient("core", API_BASE), []);
  const dash = useManagerDashboard({
    reporting,
    core,
    agencyId: AGENCY_ID,
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
