/**
 * AI insights + COMEX predictive client shell (IA-005) — S3.
 *
 * apiBase / agencyId arrive en PROPS depuis le server component (proxy /api/rt +
 * claims du JWT vérifié en mode real ; mock Prism + fixture sinon). RBAC
 * DIRECTOR+/réseau enforced by middleware (WEB-001, roles.ts). Data comes
 * EXCLUSIVELY from the CONTRACT-008 AI endpoints via the typed `ai` client —
 * the front never models nor scores (IA-005).
 * @module app/dashboard/insights/insights-page-client
 */
"use client";

import type { ReactElement } from "react";
import { useEffect, useMemo } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { AiInsightsDashboard } from "@/components/insights/ai-insights-dashboard";
import { useAiInsights } from "@/lib/use-ai-insights";

/** Analysis period / forecast date (would come from the date / bank config). */
const PERIOD = "2026-07";
const FORECAST_DATE = "2026-07-15";

/** Props dérivées côté serveur (S3). */
export interface InsightsPageClientProps {
  /** Base API : /api/rt en mode real, mock Prism sinon. */
  apiBase: string;
  /** Agence du scope JWT vérifié (ou fixture mock). */
  agencyId: string;
  /** Statut hors ligne (bannière discrète). */
  offline?: boolean;
}

/**
 * AI insights dashboard client shell.
 * @param props - {@link InsightsPageClientProps}.
 * @returns The dashboard element.
 */
export function InsightsPageClient({
  apiBase,
  agencyId,
  offline = false,
}: InsightsPageClientProps): ReactElement {
  const ai = useMemo(() => createSigfaClient("ai", apiBase), [apiBase]);
  const dash = useAiInsights({ ai, agencyId, date: FORECAST_DATE, period: PERIOD });

  useEffect(() => {
    void dash.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AiInsightsDashboard
      insights={dash.insights}
      load={dash.load}
      history={dash.history}
      offline={offline || dash.connection === "offline"}
    />
  );
}
