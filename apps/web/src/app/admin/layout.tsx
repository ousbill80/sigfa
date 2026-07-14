/**
 * /admin layout — segment authentifié (S2) : socket câblé via
 * AuthenticatedRealtime (cookie httpOnly lu et VÉRIFIÉ côté serveur). Enveloppe
 * en plus les 3 consoles dans l'AdminShell partagé (header produit + nav) pour
 * qu'elles se ressemblent (DESIGN-FIX-ADMIN).
 *
 * WEB-002-HDR : bandeau session partagé (marque banque + utilisateur + agence
 * de rattachement + déconnexion) assemblé côté serveur par SessionHeaderServer,
 * au-dessus de l'AdminShell — cohérent avec les segments agent et dashboard.
 * @module app/admin/layout
 */
import type { ReactElement } from "react";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";
import { AdminShell } from "@/components/admin/admin-shell";
import { SessionHeaderServer } from "@/components/ui/session-header-server";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): ReactElement {
  return (
    <AuthenticatedRealtime>
      <SessionHeaderServer locale="fr" />
      <AdminShell>{children}</AdminShell>
    </AuthenticatedRealtime>
  );
}
