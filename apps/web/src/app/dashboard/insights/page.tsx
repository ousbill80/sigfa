/**
 * AI insights + COMEX predictive dashboard page (IA-005) — server component (S3).
 *
 * En mode real : proxy same-origin /api/rt (Bearer injecté côté serveur) et
 * agence dérivée des claims du JWT VÉRIFIÉ (S1). En mode mock : base Prism +
 * fixture (bascule d'env RT-001b inchangée). RBAC DIRECTOR+/réseau : middleware
 * (WEB-001, roles.ts).
 * @module app/dashboard/insights/page
 */
import type { ReactElement } from "react";
import { resolveTenantContext } from "@/lib/server-session";
import { InsightsPageClient } from "./insights-page-client";

/**
 * AI insights dashboard route page.
 * @returns The page element.
 */
export default async function InsightsDashboardPage(): Promise<ReactElement> {
  const ctx = await resolveTenantContext();
  return <InsightsPageClient apiBase={ctx.apiBase} agencyId={ctx.agencyId} />;
}
