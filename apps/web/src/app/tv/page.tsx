/**
 * /tv — full-screen public call display (TV-001 + TV-002).
 * Session borne type affichage : lecture publique par agence, aucune auth.
 *
 * RT-003 : en mode temps réel `real`, l'affichage est piloté par le socket RÉEL
 * (`useSocket().tv`, alimenté par `ticket:called` + `sync:state` du contrat) et
 * l'état de connexion (`offline` sur perte réseau / handshake refusé). En mode
 * `off`, l'affichage garde la simulation F4 (fixtures TV_SEED_STATE).
 *
 * @module app/tv/page
 */
"use client";

import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { TvScreen } from "@/components/tv/tv-screen";
import { useTvClock } from "@/lib/use-tv-clock";
import { useTvSimulation } from "@/lib/use-tv-simulation";
import { useTvMode } from "@/lib/use-tv-mode";
import { useSocket } from "@/lib/socket-provider";
import { autoCorrectedBrand } from "@/lib/theme";
import { TV_SEED_STATE } from "@/lib/tv-fixtures";
import type { TvState } from "@/lib/tv-state";

/** Tenant theming resolved for the TV display (would come from the tenant claim). */
const TENANT = {
  name: "Banque du Commerce",
  // Marque du tenant démo alignée sur la palette v2 « Or & Forêt » (terracotta).
  // Le theming banque surcharge --brand ; passé par autoCorrectedBrand (WCAG).
  brand: "#c25a16",
  locale: "fr" as const,
};

/**
 * TV route page. Applies contrast-corrected tenant brand and drives the
 * call display — socket réel en mode `real`, simulation sinon.
 * @returns The page element.
 */
export default function TvPage(): ReactElement {
  const clock = useTvClock();
  const socket = useSocket();
  const { state: simState, celebration } = useTvSimulation({
    seed: TV_SEED_STATE,
    locale: TENANT.locale,
  });

  // Suivi navigateur online/offline pour la dégradation réseau (critère 2).
  const online = useOnline();

  const isRealtime = socket.status !== "inactive";

  // En mode réel : l'état vient du socket ; la connexion est `offline` si le
  // navigateur est hors-ligne OU si le socket n'est pas connecté (handshake
  // refusé / reconnexion en cours). En mode off : simulation inchangée.
  const state: TvState = useMemo(() => {
    if (!isRealtime) return simState;
    const connection = online && socket.connected ? "connected" : "offline";
    return { ...socket.tv, connection };
  }, [isRealtime, simState, socket.tv, socket.connected, online]);

  // Machine d'états repos↔appel : un appel actif (héros) bascule sur la scène
  // d'appel pendant une fenêtre ; sinon l'AdZone (zone de pub) prend l'écran.
  // Ne consomme AUCUN événement — dérive seulement de l'état temps réel existant.
  const mode = useTvMode({ hasActiveCall: state.hero !== null });

  // Contrast auto-correction : le --brand tenant est foncé si son ratio sur
  // le fond nuit (--night-2, très sombre) est insuffisant côté clair.
  const brand = autoCorrectedBrand(TENANT.brand);

  return (
    <div
      data-testid="tv-root"
      data-realtime={isRealtime ? "on" : "off"}
      style={
        {
          "--brand": brand,
          backgroundColor: "var(--night-2, var(--surface-screen))",
          minHeight: "100vh",
        } as React.CSSProperties
      }
    >
      <TvScreen
        state={state}
        locale={TENANT.locale}
        tenantName={TENANT.name}
        clock={clock}
        celebration={isRealtime ? false : celebration}
        mode={mode}
      />
    </div>
  );
}

/**
 * Suit l'état online/offline du navigateur.
 * @returns `true` tant que le navigateur se déclare en ligne.
 */
function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
