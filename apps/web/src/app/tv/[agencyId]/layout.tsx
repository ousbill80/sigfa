/**
 * /tv/[agencyId] layout — écran mural public par agence (RT-003).
 *
 * PUBLIC (Boucle 2 S2) : ce layout ne lit JAMAIS le cookie httpOnly et ne
 * réintroduit AUCUN JWT agent. Il résout le mode/URL temps réel depuis l'env et
 * délègue à {@link TvRealtime} le mint du token d'affichage DISPLAY
 * (`POST /tv/session { agencyId }`, route publique) puis le câblage socket
 * (`join:agency`, `sync:request`). L'`agencyId` provient du segment de route.
 *
 * @module app/tv/[agencyId]/layout
 */
import type { ReactElement } from "react";
import { TvRealtime } from "@/components/tv/tv-realtime";
import { resolveRealtimeMode, socketOrigin } from "@/lib/realtime-env";
import { BROWSER_API_BASE } from "@/lib/browser-api";

export default async function TvAgencyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ agencyId: string }>;
}): Promise<ReactElement> {
  const { agencyId } = await params;
  return (
    <TvRealtime
      agencyId={agencyId}
      mode={resolveRealtimeMode()}
      apiBase={BROWSER_API_BASE}
      socketUrl={socketOrigin()}
    >
      {children}
    </TvRealtime>
  );
}
