/**
 * COMEX quality dashboard page (WEB-005) — server component (S3, Boucle 2 F4).
 *
 * En mode real : proxy same-origin /api/rt (Bearer injecté côté serveur,
 * session vérifiée S1). En mode mock : base Prism (bascule d'env RT-001b
 * inchangée). RBAC BANK_ADMIN+ : middleware (WEB-001).
 * @module app/dashboard/comex/page
 */
import type { ReactElement } from "react";
import { resolveTenantContext } from "@/lib/server-session";
import { ComexPageClient } from "./comex-page-client";

/**
 * COMEX quality dashboard route page.
 * @returns The page element.
 */
export default async function ComexDashboardPage(): Promise<ReactElement> {
  const ctx = await resolveTenantContext();
  return <ComexPageClient apiBase={ctx.apiBase} />;
}
