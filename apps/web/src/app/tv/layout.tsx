/**
 * /tv layout — affichage public temps réel SANS jamais recevoir le JWT (S2).
 *
 * /tv est une route publique (TV-001) : son arbre client reçoit un
 * SocketProvider (mode d'env) mais JAMAIS le cookie httpOnly. En mode real, le
 * handshake part sans token ; si le serveur l'exige, le provider tombe en état
 * `error` → repli offline de l'écran TV (D7). Couture consignée : un accès
 * socket public par agence (ou token d'affichage dédié) relève du contrat —
 * routé vers agent-contract/agent-api.
 * @module app/tv/layout
 */
import type { ReactElement } from "react";
import { SocketProvider } from "@/lib/socket-provider";
import { resolveRealtimeMode, socketOrigin } from "@/lib/realtime-env";

export default async function TvLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<ReactElement> {
  return (
    <SocketProvider mode={resolveRealtimeMode()} url={socketOrigin()}>
      {children}
    </SocketProvider>
  );
}
