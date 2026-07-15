/**
 * /tv — full-screen public call display (TV-001 + TV-002), agence par défaut.
 *
 * Session borne type affichage : lecture publique, aucune auth agent. Le rendu
 * et la logique temps réel (socket real / simulation off) sont portés par
 * {@link TvDisplay}. La variante par agence vit sous `/tv/[agencyId]` (RT-003).
 *
 * Composant serveur : marque banque / agence / logo (convention
 * lib/bank-branding) résolus ici côté serveur puis passés en prop — jamais de
 * littéral d'enseigne figé dans ce fichier.
 *
 * @module app/tv/page
 */
import type { ReactElement } from "react";
import { TvDisplay, type TvTenant } from "@/components/tv/tv-display";
import { agencyName, bankLogoUrl, bankName } from "@/lib/bank-branding";

/**
 * TV route page (agence par défaut).
 * @returns The page element.
 */
export default function TvPage(): ReactElement {
  /** Tenant theming résolu via provisionnement env (lib/bank-branding). */
  const tenant: TvTenant = {
    name: bankName(),
    agencyName: agencyName(),
    // Marque du tenant démo — repli produit v3 Neutre Premium.
    brand: "#1d4ed8",
    locale: "fr",
    logoUrl: bankLogoUrl(),
  };
  return <TvDisplay tenant={tenant} />;
}
