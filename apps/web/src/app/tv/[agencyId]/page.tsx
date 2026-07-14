/**
 * /tv/[agencyId] — écran mural public plein écran d'une agence (RT-003).
 *
 * L'`agencyId` de la route pilote la room socket (`join:agency`, câblé par le
 * layout via {@link TvRealtime}). Le token d'affichage DISPLAY est minté côté
 * client (lecture seule, aucune PII) : aucun cookie ni JWT agent ici.
 *
 * L'habillage premium v2 est porté par {@link TvDisplay} → {@link TvScreen} ;
 * cette page ne fait que le tenant demo + le rendu.
 *
 * @module app/tv/[agencyId]/page
 */
import type { ReactElement } from "react";
import { TvDisplay, type TvTenant } from "@/components/tv/tv-display";
import { bankLogoUrl } from "@/lib/bank-branding";

/**
 * Theming démo de l'agence. Le token DISPLAY et le socket ne portent aucune PII
 * ni nom de tenant : le nom/couleur affichés relèvent d'un habillage (theming
 * banque), résolu ici en dur pour la démo (surchargeable ultérieurement). Le
 * logo suit la convention lib/bank-branding (`NEXT_PUBLIC_BANK_LOGO_URL`),
 * résolue côté serveur — repli pastille --brand + initiale sans logo.
 */
const DEMO_TENANT: TvTenant = {
  name: "Banque du Commerce",
  brand: "#c25a16",
  locale: "fr",
  logoUrl: bankLogoUrl(),
};

export default async function TvAgencyPage({
  params,
}: {
  params: Promise<{ agencyId: string }>;
}): Promise<ReactElement> {
  // L'agencyId est consommé par le layout (room socket) ; la page l'attend pour
  // rester alignée sur le contrat de segment App Router.
  await params;
  return <TvDisplay tenant={DEMO_TENANT} />;
}
