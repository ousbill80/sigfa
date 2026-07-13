/**
 * Reporting surface client shell (REP-003b).
 *
 * apiBase / bankId / agencyId / role arrive as PROPS from the server component
 * (proxy /api/rt + verified JWT claims in real mode; Prism mock + fixture
 * otherwise). RBAC AGENCY_DIRECTOR+/AUDITOR is enforced by middleware
 * (roles.ts) AND re-checked in ReportsDashboard (defence in depth). Data comes
 * from GET /reports/export(+/{jobId}) and GET /reports/benchmark (REP-003).
 * @module app/dashboard/reports/reports-page-client
 */
"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { ReportsDashboard } from "@/components/reports/reports-dashboard";
import type { Role } from "@/lib/roles";

/** Default analysis period (would come from the date / bank config). */
const PERIOD = "2026-07";

/** Props derived server-side. */
export interface ReportsPageClientProps {
  /** Base API: /api/rt in real mode, Prism mock otherwise. */
  apiBase: string;
  /** Bank of the verified JWT (or mock fixture). */
  bankId: string;
  /** First agency of the verified JWT scope (or mock fixture). */
  agencyId: string;
  /** Verified JWT role — gates the surface. */
  role: Role;
}

/**
 * Reporting surface client shell.
 * @param props - {@link ReportsPageClientProps}.
 * @returns The dashboard element.
 */
export function ReportsPageClient({
  apiBase,
  bankId,
  agencyId,
  role,
}: ReportsPageClientProps): ReactElement {
  const reporting = useMemo(() => createSigfaClient("reporting", apiBase), [apiBase]);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const goOffline = (): void => setOffline(true);
    const goOnline = (): void => setOffline(false);
    if (!navigator.onLine) setOffline(true);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  return (
    <ReportsDashboard
      reporting={reporting}
      bankId={bankId}
      agencyId={agencyId}
      role={role}
      period={PERIOD}
      offline={offline}
    />
  );
}
