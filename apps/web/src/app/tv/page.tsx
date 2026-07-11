/**
 * /tv — full-screen public call display (TV-001 + TV-002).
 * Session borne type affichage : lecture publique par agence, aucune auth.
 * Realtime is simulated (RT-001 keeps sockets inactive).
 * @module app/tv/page
 */
"use client";

import type { ReactElement } from "react";
import { TvScreen } from "@/components/tv/tv-screen";
import { useTvClock } from "@/lib/use-tv-clock";
import { useTvSimulation } from "@/lib/use-tv-simulation";
import { autoCorrectedBrand } from "@/lib/theme";
import { TV_SEED_STATE } from "@/lib/tv-fixtures";

/** Tenant theming resolved for the TV display (would come from the tenant claim). */
const TENANT = {
  name: "Banque du Commerce",
  brand: "#1a56db",
  locale: "fr" as const,
};

/**
 * TV route page. Applies contrast-corrected tenant brand and drives the
 * simulated call display.
 * @returns The page element.
 */
export default function TvPage(): ReactElement {
  const clock = useTvClock();
  const { state, celebration } = useTvSimulation({ seed: TV_SEED_STATE, locale: TENANT.locale });

  // Contrast auto-correction : le --brand tenant est foncé si son ratio sur
  // --surface-screen (#0A0F1A, fond très sombre) est insuffisant côté clair.
  const brand = autoCorrectedBrand(TENANT.brand);

  return (
    <div style={{ "--brand": brand } as React.CSSProperties}>
      <TvScreen
        state={state}
        locale={TENANT.locale}
        tenantName={TENANT.name}
        clock={clock}
        celebration={celebration}
      />
    </div>
  );
}
