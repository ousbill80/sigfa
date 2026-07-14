/**
 * /agent layout — segment authentifié (S2) : socket câblé via
 * AuthenticatedRealtime (cookie httpOnly lu et VÉRIFIÉ côté serveur).
 *
 * WEB-002-HDR : le bandeau SessionHeader (agent connecté + « Se déconnecter »)
 * est rendu côté serveur depuis les claims du JWT VÉRIFIÉ — seules des données
 * dérivées (nom, rôle) descendent dans l'arbre, jamais le token brut. Sans
 * session vérifiée (mode mock RT-001b), le bandeau est simplement absent.
 * @module app/agent/layout
 */
import type { ReactElement } from "react";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";
import { readVerifiedSession } from "@/lib/server-session";
import { SessionHeader } from "@/components/ui/session-header";

export default async function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<ReactElement> {
  const session = await readVerifiedSession();
  return (
    <AuthenticatedRealtime>
      {session && (
        <SessionHeader name={session.claims.displayName} role={session.claims.role} locale="fr" />
      )}
      {children}
    </AuthenticatedRealtime>
  );
}
