/**
 * /dashboard layout — segment authentifié (S2) : socket câblé via
 * AuthenticatedRealtime (cookie httpOnly lu et VÉRIFIÉ côté serveur).
 *
 * WEB-002-HDR : bandeau session partagé (marque banque + utilisateur + agence
 * de rattachement + déconnexion) assemblé côté serveur par SessionHeaderServer
 * — commun aux dashboards manager/COMEX. Sans session vérifiée (mode mock
 * RT-001b), le bandeau est simplement absent.
 * @module app/dashboard/layout
 */
import type { ReactElement } from "react";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";
import { SessionHeaderServer } from "@/components/ui/session-header-server";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): ReactElement {
  return (
    <AuthenticatedRealtime>
      <SessionHeaderServer locale="fr" />
      {children}
    </AuthenticatedRealtime>
  );
}
