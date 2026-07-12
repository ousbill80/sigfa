/**
 * Manager dashboard page (WEB-003) — server component (S3, Boucle 2 F4).
 *
 * En mode real : proxy same-origin /api/rt (Bearer injecté côté serveur) et
 * agence dérivée des claims du JWT VÉRIFIÉ (S1). En mode mock : base Prism +
 * fixture (bascule d'env RT-001b inchangée). RBAC : middleware (WEB-001).
 * @module app/dashboard/manager/page
 */
import type { ReactElement } from "react";
import { resolveTenantContext } from "@/lib/server-session";
import { ManagerPageClient } from "./manager-page-client";

/**
 * Manager dashboard route page.
 * @returns The page element.
 */
export default async function ManagerDashboardPage(): Promise<ReactElement> {
  const ctx = await resolveTenantContext();
  return <ManagerPageClient apiBase={ctx.apiBase} agencyId={ctx.agencyId} />;
}
