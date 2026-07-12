/**
 * /tv — full-screen public call display (TV-001 + TV-002), agence par défaut.
 *
 * Session borne type affichage : lecture publique, aucune auth agent. Le rendu
 * et la logique temps réel (socket real / simulation off) sont portés par
 * {@link TvDisplay}. La variante par agence vit sous `/tv/[agencyId]` (RT-003).
 *
 * @module app/tv/page
 */
"use client";

import type { ReactElement } from "react";
import { TvDisplay, type TvTenant } from "@/components/tv/tv-display";

/** Tenant theming resolved for the default TV display. */
const TENANT: TvTenant = {
  name: "Banque du Commerce",
  // Marque du tenant démo alignée sur la palette v2 « Or & Forêt » (terracotta).
  brand: "#c25a16",
  locale: "fr",
};

/**
 * TV route page (agence par défaut).
 * @returns The page element.
 */
export default function TvPage(): ReactElement {
  return <TvDisplay tenant={TENANT} />;
}
