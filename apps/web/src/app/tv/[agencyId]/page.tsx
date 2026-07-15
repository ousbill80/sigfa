/**
 * /tv/[agencyId] — écran mural public plein écran d'une agence (RT-003).
 *
 * L'`agencyId` de la route pilote la room socket (`join:agency`, câblé par le
 * layout via {@link TvRealtime}). Le token d'affichage DISPLAY est minté côté
 * client (lecture seule, aucune PII) : aucun cookie ni JWT agent ici.
 *
 * L'habillage Neutre Premium v3 est porté par {@link TvDisplay} → {@link TvScreen} ;
 * les libellés banque / agence / logo viennent du provisionnement
 * ({@link bankName}, {@link agencyName}, {@link bankLogoUrl}) — jamais figés
 * en dur. Couture ultérieure : theme tenant / API publique par `agencyId`.
 *
 * @module app/tv/[agencyId]/page
 */
import type { ReactElement } from "react";
import { TvDisplay, type TvTenant } from "@/components/tv/tv-display";
import { agencyName, bankLogoUrl, bankName } from "@/lib/bank-branding";

/**
 * Theming d'affichage résolu au provisionnement. Le token DISPLAY et le socket
 * ne portent aucune PII ni nom de tenant : le nom/couleur affichés relèvent
 * d'un habillage (theming banque), via env jusqu'à la bascule theme tenant.
 */
function resolveDemoTenant(): TvTenant {
  return {
    name: bankName(),
    agencyName: agencyName(),
    brand: "#1d4ed8",
    locale: "fr",
    logoUrl: bankLogoUrl(),
  };
}

export default async function TvAgencyPage({
  params,
}: {
  params: Promise<{ agencyId: string }>;
}): Promise<ReactElement> {
  // L'agencyId est consommé par le layout (room socket) ; la page l'attend pour
  // rester alignée sur le contrat de segment App Router.
  await params;
  return <TvDisplay tenant={resolveDemoTenant()} />;
}
