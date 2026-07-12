/**
 * COMEX quality dashboard client shell (WEB-005) — S3 (Boucle 2 F4).
 *
 * apiBase arrive en PROP depuis le server component (proxy /api/rt en mode
 * real ; mock Prism sinon). RBAC BANK_ADMIN+ enforced by middleware (WEB-001).
 * KPIs from GET /reports/kpis?scope=network (canonical route). TV mode via
 * `?tv=1` or the BANK_ADMIN+ toggle.
 * @module app/dashboard/comex/comex-page-client
 */
"use client";

import type { ReactElement } from "react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSigfaClient } from "@sigfa/contracts";
import { ComexDashboard } from "@/components/comex/comex-dashboard";
import { useComexDashboard } from "@/lib/use-comex-dashboard";

/** Periods + SLA (would come from the date / bank config). */
const PERIOD = "2026-07";
const PREVIOUS_PERIOD = "2026-06";
const SLA_MINUTES = 15;

/** Props dérivées côté serveur (S3). */
export interface ComexPageClientProps {
  /** Base API : /api/rt en mode real, mock Prism sinon. */
  apiBase: string;
}

/**
 * COMEX dashboard client shell.
 * Wraps the search-params-dependent content in a Suspense boundary (Next.js 15
 * requirement for `useSearchParams` during static generation).
 * @param props - {@link ComexPageClientProps}.
 * @returns The dashboard element.
 */
export function ComexPageClient({ apiBase }: ComexPageClientProps): ReactElement {
  return (
    <Suspense fallback={<ComexDashboard kpis={null} load="loading" slaMinutes={SLA_MINUTES} />}>
      <ComexDashboardContent apiBase={apiBase} />
    </Suspense>
  );
}

/**
 * COMEX dashboard content.
 * The page is only reachable by BANK_ADMIN+ (middleware), so the viewer may
 * toggle TV mode. `?tv=1` forces the read-only TV projection.
 * @param props - {@link ComexPageClientProps}.
 * @returns The content element.
 */
function ComexDashboardContent({ apiBase }: ComexPageClientProps): ReactElement {
  const params = useSearchParams();
  const forcedTv = params.get("tv") === "1";
  const [tvToggle, setTvToggle] = useState(false);
  const tvMode = forcedTv || tvToggle;

  const reporting = useMemo(() => createSigfaClient("reporting", apiBase), [apiBase]);
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
