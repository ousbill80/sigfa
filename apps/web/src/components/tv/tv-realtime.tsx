/**
 * TvRealtime — pont entre le token d'affichage DISPLAY et le socket (RT-003).
 *
 * `/tv/{agencyId}` est PUBLIC (Boucle 2 S2) : aucun cookie ni JWT agent. Ce
 * composant client mint un token d'affichage à privilèges minimaux via
 * `POST /tv/session { agencyId }` ({@link useTvSession}), puis le passe au
 * {@link SocketProvider} comme token de handshake. Le provider émet ensuite
 * `join:agency { agencyId }` (forme UNIQUE contractualisée) et
 * `sync:request { agencyId }` à chaque (re)connexion.
 *
 * Repli offline : tant que le token n'est pas obtenu (mint en cours ou en
 * erreur : 404 `AGENCY_NOT_FOUND`, réseau, 429 après backoff), le provider reste
 * `inactive` — aucun handshake tenté sans token — et l'écran affiche son état
 * offline (dernier snapshot en mémoire s'il existe, sinon écran d'attente).
 * Aucun crash : c'est l'un des 5 états requis.
 *
 * @module components/tv/tv-realtime
 */
"use client";

import type { ReactElement, ReactNode } from "react";
import { SocketProvider, type RealtimeMode } from "@/lib/socket-provider";
import { useTvSession } from "@/lib/tv-session";

/** Props de {@link TvRealtime}. */
export interface TvRealtimeProps {
  /** Agence dont l'écran rejoint la room (`join:agency`). */
  agencyId: string;
  /** Mode temps réel : `off` → fixtures F4 ; `real` → mint + socket réel. */
  mode: RealtimeMode;
  /** Base REST du contrat public (mint de session). */
  apiBase: string;
  /** Origine socket.io (handshake WS). */
  socketUrl: string;
  /** Arbre TV (page). */
  children: ReactNode;
}

/**
 * Enveloppe l'écran TV d'un SocketProvider alimenté par un token DISPLAY.
 *
 * Le provider n'est activé (`real`) qu'une fois le token obtenu : on ne tente
 * jamais de handshake sans token (évite une boucle d'échecs). En `off`, ou tant
 * que le token n'est pas prêt, le provider reste `inactive` → repli offline.
 *
 * @param props - {@link TvRealtimeProps}.
 * @returns L'élément provider.
 */
export function TvRealtime(props: TvRealtimeProps): ReactElement {
  const { agencyId, mode, apiBase, socketUrl, children } = props;
  const session = useTvSession({ agencyId, mode, apiBase });

  // Active le socket réel UNIQUEMENT quand le token DISPLAY est disponible.
  // Sinon (mint en cours / en erreur / mode off) → provider inactif = offline.
  const socketMode: RealtimeMode =
    mode === "real" && session.accessToken !== undefined ? "real" : "off";

  return (
    <SocketProvider
      mode={socketMode}
      url={socketUrl}
      token={session.accessToken}
      agencyId={agencyId}
    >
      {children}
    </SocketProvider>
  );
}
