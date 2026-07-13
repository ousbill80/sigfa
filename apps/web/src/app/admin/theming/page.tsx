/**
 * Theming console page (ADM-001b) — server component.
 *
 * Derives the tenant context server side (verified JWT claims in real mode,
 * fixtures in mock mode) and hands bankId/role/apiBase to the client shell.
 * RBAC: middleware (WEB-001) gates /admin first; the ThemingConsole re-checks
 * (BANK_ADMIN+) in depth.
 *
 * @module app/admin/theming/page
 */
import type { ReactElement } from "react";
import { resolveTenantContext } from "@/lib/server-session";
import { ThemingPageClient } from "./theming-page-client";

/**
 * Theming console route page.
 * @returns The page element.
 */
export default async function ThemingPage(): Promise<ReactElement> {
  const ctx = await resolveTenantContext();
  return <ThemingPageClient apiBase={ctx.apiBase} bankId={ctx.bankId} role={ctx.role} />;
}
