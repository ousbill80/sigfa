/**
 * AuthenticatedRealtime — câblage socket des segments AUTHENTIFIÉS (S2).
 *
 * Server component. En mode real, il lit le cookie httpOnly `access_token`,
 * VÉRIFIE sa signature (S1, lib/session) puis — et seulement alors — injecte
 * token + agencyId (claims vérifiés) dans le SocketProvider client. Monté
 * UNIQUEMENT sous les segments authentifiés (/agent, /dashboard, /admin) :
 * le JWT n'est plus jamais sérialisé dans le payload RSC des routes publiques
 * (/login, /tv). En mode off, provider inactif (fixtures F4 inchangées).
 *
 * Couture consignée : l'injection du JWT d'accès dans le handshake socket des
 * segments authentifiés reste nécessaire tant que l'API n'émet pas de token
 * socket dédié court/TTL (changement de contrat — routé vers agent-contract).
 * @module lib/authenticated-realtime
 */
import type { ReactElement, ReactNode } from "react";
import { SocketProvider } from "./socket-provider";
import { readVerifiedSession } from "./server-session";
import { resolveRealtimeMode, socketOrigin } from "./realtime-env";

/**
 * Enveloppe un segment authentifié avec le SocketProvider câblé.
 * @param props - children du segment.
 * @returns Le provider avec token/agencyId vérifiés (mode real) ou inactif.
 */
export async function AuthenticatedRealtime({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const mode = resolveRealtimeMode();
  const url = socketOrigin();

  let token: string | undefined;
  let agencyId: string | undefined;
  if (mode === "real") {
    // Vérification de signature AVANT toute injection (S1×S2).
    const verified = await readVerifiedSession();
    token = verified?.token;
    agencyId = verified?.claims.agencyIds[0];
  }

  return (
    <SocketProvider mode={mode} url={url} token={token} agencyId={agencyId}>
      {children}
    </SocketProvider>
  );
}
