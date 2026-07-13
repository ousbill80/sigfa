/**
 * Reporting surface page (REP-003b) — server component.
 *
 * In real mode: same-origin proxy /api/rt (Bearer injected server-side, session
 * verified S1) and tenant context derived from the verified JWT claims. In mock
 * mode: Prism base + fixture (RT-001b env switch). RBAC AGENCY_DIRECTOR+/AUDITOR
 * is enforced by the middleware (roles.ts).
 * @module app/dashboard/reports/page
 */
import type { ReactElement } from "react";
import { resolveTenantContext } from "@/lib/server-session";
import { ReportsPageClient } from "./reports-page-client";

/**
 * Reporting surface route page.
 * @returns The page element.
 */
export default async function ReportsPage(): Promise<ReactElement> {
  const ctx = await resolveTenantContext();
  return (
    <ReportsPageClient
      apiBase={ctx.apiBase}
      bankId={ctx.bankId}
      agencyId={ctx.agencyId}
      role={ctx.role}
    />
  );
}
