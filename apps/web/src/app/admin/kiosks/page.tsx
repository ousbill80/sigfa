/**
 * Kiosk supervision page (ADM-003b) — server component (S3).
 *
 * Derives the tenant context server-side: in real mode the API base is the
 * same-origin proxy /api/rt, the agencyId/role come from the VERIFIED JWT claims
 * (S1), and the raw token (read httpOnly, never exposed to other client code) is
 * handed to the shell for the socket handshake; in mock mode it uses the Prism
 * base + fixtures (RT-001b env switch unchanged). RBAC (AGENT / AUDITOR → 403)
 * is enforced by the middleware (WEB-001); the network view is further gated to
 * BANK_ADMIN+ inside the shell.
 * @module app/admin/kiosks/page
 */
import type { ReactElement } from "react";
import { resolveTenantContext, readVerifiedSession } from "@/lib/server-session";
import { socketOrigin } from "@/lib/realtime-env";
import { KiosksPageClient } from "./kiosks-page-client";

/**
 * Kiosk supervision route page.
 * @returns The page element.
 */
export default async function KiosksSupervisionPage(): Promise<ReactElement> {
  const ctx = await resolveTenantContext();
  const token = ctx.realtime ? (await readVerifiedSession())?.token : undefined;
  return (
    <KiosksPageClient
      apiBase={ctx.apiBase}
      agencyId={ctx.agencyId}
      role={ctx.role}
      realtime={ctx.realtime}
      socketUrl={ctx.realtime ? socketOrigin() : undefined}
      token={token}
    />
  );
}
