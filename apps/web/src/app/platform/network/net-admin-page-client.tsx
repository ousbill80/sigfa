/**
 * Super Admin network console client shell (NET-001-WEB) — S3.
 *
 * apiBase arrives in PROPS from the server component (proxy /api/rt + verified
 * JWT claims in real mode; mock Prism base otherwise). RBAC SUPER_ADMIN is
 * enforced by the middleware (roles: /platform → SUPER_ADMIN only). Data comes
 * exclusively from the typed @sigfa/contracts reporting client on the canonical
 * LAW route GET /admin/network-overview — READ ONLY, allow-listed. There is no
 * mutation path here.
 * @module app/platform/network/net-admin-page-client
 */
"use client";

import type { ReactElement } from "react";
import { useEffect, useMemo } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { NetAdminConsole } from "@/components/net-admin/net-admin-console";
import { useNetAdminConsole } from "@/lib/use-net-admin-console";

/** Supervision period (would come from the date picker / config). */
const PERIOD = "2026-07";

/** Props derived server-side (S3). */
export interface NetAdminPageClientProps {
  /** Base API: /api/rt in real mode, mock Prism base otherwise. */
  apiBase: string;
}

/**
 * Super Admin network console client shell.
 * @param props - {@link NetAdminPageClientProps}.
 * @returns The console element.
 */
export function NetAdminPageClient({ apiBase }: NetAdminPageClientProps): ReactElement {
  const reporting = useMemo(() => createSigfaClient("reporting", apiBase), [apiBase]);
  const netConsole = useNetAdminConsole({ reporting, period: PERIOD });

  useEffect(() => {
    void netConsole.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <NetAdminConsole view={netConsole.view} load={netConsole.load} />;
}
