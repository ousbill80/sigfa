/**
 * /admin layout — segment authentifié (S2) : socket câblé via
 * AuthenticatedRealtime (cookie httpOnly lu et VÉRIFIÉ côté serveur). Enveloppe
 * en plus les 3 consoles dans l'AdminShell partagé (header produit + nav) pour
 * qu'elles se ressemblent (DESIGN-FIX-ADMIN).
 * @module app/admin/layout
 */
import type { ReactElement } from "react";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";
import { AdminShell } from "@/components/admin/admin-shell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): ReactElement {
  return (
    <AuthenticatedRealtime>
      <AdminShell>{children}</AdminShell>
    </AuthenticatedRealtime>
  );
}
