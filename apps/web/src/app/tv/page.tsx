/**
 * /tv — full-screen public call display (TV-001 + TV-002), agence par défaut.
 *
 * Session borne type affichage : lecture publique, aucune auth agent. Le rendu
 * et la logique temps réel (socket real / simulation off) sont portés par
 * {@link TvDisplay}. La variante par agence vit sous `/tv/[agencyId]` (RT-003).
 *
 * Composant serveur : le logo banque (convention lib/bank-branding,
 * `NEXT_PUBLIC_BANK_LOGO_URL`) est résolu ici côté serveur puis passé en prop
 * — repli pastille --brand + initiale sans logo provisionné.
 *
 * @module app/tv/page
 */
import type { ReactElement } from "react";
import { TvDisplay, type TvTenant } from "@/components/tv/tv-display";
import { bankLogoUrl } from "@/lib/bank-branding";

/**
 * TV route page (agence par défaut).
 * @returns The page element.
 */
export default function TvPage(): ReactElement {
  /** Tenant theming resolved for the default TV display. */
  const tenant: TvTenant = {
    name: "Banque du Commerce",
    // Marque du tenant démo alignée sur la palette v3 « Neutre Premium ».
    brand: "#1d4ed8",
    locale: "fr",
    logoUrl: bankLogoUrl(),
  };
  return <TvDisplay tenant={tenant} />;
}
