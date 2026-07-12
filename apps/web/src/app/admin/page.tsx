/**
 * Admin console page (WEB-006) — server component (S3, Boucle 2 F4).
 *
 * Dérive le contexte tenant CÔTÉ SERVEUR : en mode real, base API = proxy
 * same-origin /api/rt (Bearer httpOnly injecté par le route handler) et
 * bankId/agencyId/role = claims du JWT VÉRIFIÉ (S1) ; en mode mock, base
 * Prism + fixtures (bascule d'env RT-001b inchangée). RBAC : middleware
 * (WEB-001) en première ligne, redirection /login en défense en profondeur.
 * @module app/admin/page
 */
import type { ReactElement } from "react";
import { resolveTenantContext } from "@/lib/server-session";
import { AdminPageClient } from "./admin-page-client";

/**
 * Admin console route page.
 * @returns The page element.
 */
export default async function AdminPage(): Promise<ReactElement> {
  const ctx = await resolveTenantContext();
  return (
    <AdminPageClient
      apiBase={ctx.apiBase}
      bankId={ctx.bankId}
      agencyId={ctx.agencyId}
      role={ctx.role}
    />
  );
}
