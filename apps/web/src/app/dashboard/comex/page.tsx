/**
 * COMEX quality dashboard page (WEB-005).
 *
 * RBAC BANK_ADMIN+ enforced by middleware (WEB-001; AGENT / MANAGER /
 * AGENCY_DIRECTOR → 403). KPIs from GET /reports/kpis?scope=network (canonical
 * route — /reports/comex is a rejected invention). TV mode activated by `?tv=1`
 * or the BANK_ADMIN+ toggle. Realtime simulated (RT-001).
 * @module app/dashboard/comex/page
 */
"use client";

import type { ReactElement } from "react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSigfaClient } from "@sigfa/contracts";
import { ComexDashboard } from "@/components/comex/comex-dashboard";
import { useComexDashboard } from "@/lib/use-comex-dashboard";

/** Prism mock base URL (RT-001 keeps the real socket inactive). */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";

/** Periods + SLA (would come from the date / bank config). */
const PERIOD = "2026-07";
const PREVIOUS_PERIOD = "2026-06";
const SLA_MINUTES = 15;

/**
 * COMEX quality dashboard route page.
 * Wraps the search-params-dependent content in a Suspense boundary (Next.js 15
 * requirement for `useSearchParams` during static generation).
 * @returns The page element.
 */
export default function ComexDashboardPage(): ReactElement {
  return (
    <Suspense fallback={<ComexDashboard kpis={null} load="loading" slaMinutes={SLA_MINUTES} />}>
      <ComexDashboardContent />
    </Suspense>
  );
}

/**
 * COMEX dashboard content.
 * The page is only reachable by BANK_ADMIN+ (middleware), so the viewer may
 * toggle TV mode. `?tv=1` forces the read-only TV projection.
 * @returns The content element.
 */
function ComexDashboardContent(): ReactElement {
  const params = useSearchParams();
  const forcedTv = params.get("tv") === "1";
  const [tvToggle, setTvToggle] = useState(false);
  const tvMode = forcedTv || tvToggle;

  const reporting = useMemo(() => createSigfaClient("reporting", API_BASE), []);
  const dash = useComexDashboard({
    reporting,
    period: PERIOD,
    previousPeriod: PREVIOUS_PERIOD,
    slaMinutes: SLA_MINUTES,
  });

  useEffect(() => {
    void dash.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ComexDashboard
      kpis={dash.kpis}
      load={dash.load}
      slaMinutes={SLA_MINUTES}
      tvMode={tvMode}
      canToggleTv
      onToggleTv={() => setTvToggle((v) => !v)}
      offline={dash.connection === "offline"}
    />
  );
}
