/**
 * Network direction dashboard page (WEB-004) — server component (S3, Boucle 2
 * F4).
 *
 * En mode real : proxy same-origin /api/rt (Bearer injecté côté serveur) et
 * banque dérivée des claims du JWT VÉRIFIÉ (S1). En mode mock : base Prism +
 * fixture (bascule d'env RT-001b inchangée). RBAC : middleware (WEB-001).
 * @module app/dashboard/network/page
 */
import type { ReactElement } from "react";
import { resolveTenantContext } from "@/lib/server-session";
import { NetworkPageClient } from "./network-page-client";

/**
 * Network direction dashboard route page.
 * @returns The page element.
 */
export default async function NetworkDashboardPage(): Promise<ReactElement> {
  const ctx = await resolveTenantContext();
  return <NetworkPageClient apiBase={ctx.apiBase} bankId={ctx.bankId} />;
}
