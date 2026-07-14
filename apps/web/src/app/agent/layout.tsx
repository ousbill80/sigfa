/**
 * /agent layout — segment authentifié (S2) : socket câblé via
 * AuthenticatedRealtime (cookie httpOnly lu et VÉRIFIÉ côté serveur).
 *
 * WEB-002-HDR : le bandeau session (marque banque + agent connecté + agence
 * de rattachement + « Se déconnecter ») est assemblé côté serveur par
 * SessionHeaderServer depuis les claims du JWT VÉRIFIÉ — seules des données
 * dérivées descendent dans l'arbre, jamais le token brut. Sans session
 * vérifiée (mode mock RT-001b), le bandeau est simplement absent.
 * @module app/agent/layout
 */
import type { ReactElement } from "react";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";
import { SessionHeaderServer } from "@/components/ui/session-header-server";

export default function AgentLayout({
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
