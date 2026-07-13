/**
 * Auditor screen route (SEC-001b) — server component.
 *
 * In real mode: same-origin proxy /api/rt (Bearer injected server-side, session
 * verified S1) with tenant context derived from the verified JWT claims. In mock
 * mode: Prism base + fixture (RT-001b env switch).
 *
 * RBAC (leçon SEC-F3-01): the Auditor surface is reserved to AUDITOR / SUPER_ADMIN
 * (+ BANK_ADMIN for their own bank, per roles.ts). It is enforced by the middleware
 * AND re-checked HERE server-side (defence in depth, WEB-001): any other role
 * (MANAGER / AGENT / AGENCY_DIRECTOR) receives a 403 rendered on the server — no
 * client component ever decides access. The screen is strictly read-only.
 * @module app/audit/page
 */
import type { ReactElement } from "react";
import { resolveTenantContext } from "@/lib/server-session";
import { canAccess } from "@/lib/roles";
import { AuditPageClient } from "./audit-page-client";
import { AuditForbidden } from "./audit-forbidden";

/** Auditor screen route page. */
export default async function AuditPage(): Promise<ReactElement> {
  const ctx = await resolveTenantContext();
  // Defence in depth (server-side 403): only AUDITOR / SUPER_ADMIN / BANK_ADMIN
  // may reach the audit trail. MANAGER / AGENT / AGENCY_DIRECTOR → 403 (server).
  if (!canAccess(ctx.role, "/audit")) {
    return <AuditForbidden />;
  }
  return <AuditPageClient apiBase={ctx.apiBase} />;
}
