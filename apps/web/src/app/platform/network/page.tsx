/**
 * Super Admin network console page (NET-001-WEB) — server component (S3).
 *
 * En mode real : proxy same-origin /api/rt (Bearer injecté côté serveur), scope
 * PLATEFORME (SUPER_ADMIN, bank_id IS NULL — aucune banque). En mode mock : base
 * Prism. RBAC SUPER_ADMIN : middleware (roles /platform). Lecture seule
 * cross-tenant.
 * @module app/platform/network/page
 */
import type { ReactElement } from "react";
import { resolveTenantContext } from "@/lib/server-session";
import { NetAdminPageClient } from "./net-admin-page-client";

/**
 * Super Admin network console route page.
 * @returns The page element.
 */
export default async function PlatformNetworkPage(): Promise<ReactElement> {
  const ctx = await resolveTenantContext();
  return <NetAdminPageClient apiBase={ctx.apiBase} />;
}
