/**
 * Network direction dashboard page (WEB-004).
 * RBAC BANK_ADMIN / AGENCY_DIRECTOR enforced by middleware (AGENT → 403).
 * Data from GET /reports/benchmark + GET /admin/network-overview (canonical
 * routes — /reports/network is a rejected invention). Realtime simulated (RT-001).
 * @module app/dashboard/network/page
 */
"use client";

import type { ReactElement } from "react";
import { useEffect, useMemo } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { NetworkDashboard } from "@/components/network/network-dashboard";
import { useNetworkDashboard } from "@/lib/use-network-dashboard";
import { OfflineBanner } from "@/components/ui/offline-banner";

/** Prism mock base URL (RT-001 keeps the real socket inactive). */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";

/** Bank + period (would come from the JWT claim / date). */
const BANK_ID = "bank-ci-001";
const PERIOD = "2026-07";
const SLA_MINUTES = 15;

/**
 * Network direction dashboard route page.
 * @returns The page element.
 */
export default function NetworkDashboardPage(): ReactElement {
  const reporting = useMemo(() => createSigfaClient("reporting", API_BASE), []);
  const dash = useNetworkDashboard({ reporting, bankId: BANK_ID, period: PERIOD, slaMinutes: SLA_MINUTES });

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
