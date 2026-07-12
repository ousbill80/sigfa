/**
 * TvDisplay — orchestration de l'affichage TV plein écran (TV-001/002 + RT-003).
 *
 * Composant client partagé par `/tv` et `/tv/[agencyId]`. Il choisit la source
 * d'état :
 *   - mode `real` (socket actif) : l'état vient du socket (`ticket:called` +
 *     `sync:state`), la connexion est `offline` si le navigateur est hors-ligne
 *     OU si le socket n'est pas connecté (handshake refusé, mint échoué → aucun
 *     token → provider inactif, reconnexion en cours). Le dernier snapshot reste
 *     en mémoire (dernier état du reducer), sinon écran d'attente.
 *   - mode `off` : simulation F4 inchangée (fixtures TV_SEED_STATE).
 *
 * L'habillage premium v2 (« Sérénité Premium ») est intégralement porté par
 * {@link TvScreen} : ce composant n'ajoute QUE la logique de données/connexion.
 *
 * @module components/tv/tv-display
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
import type { Locale } from "@/lib/i18n";

/** Theming résolu pour l'écran TV (viendrait du claim tenant / agence). */
export interface TvTenant {
  /** Nom de banque affiché dans l'en-tête. */
  name: string;
  /** Couleur de marque du tenant (corrigée WCAG sur fond nuit). */
  brand: string;
  /** Langue d'affichage. */
  locale: Locale;
}

/** Props de {@link TvDisplay}. */
export interface TvDisplayProps {
  /** Theming du tenant. */
  tenant: TvTenant;
}

/**
 * Écran TV plein écran, piloté par le socket (real) ou la simulation (off).
 * @param props - {@link TvDisplayProps}.
 * @returns L'élément d'affichage.
 */
export function TvDisplay({ tenant }: TvDisplayProps): ReactElement {
  const clock = useTvClock();
  const socket = useSocket();
  const { state: simState, celebration } = useTvSimulation({
    seed: TV_SEED_STATE,
    locale: tenant.locale,
  });

  const online = useOnline();
  const isRealtime = socket.status !== "inactive";

  // En real : l'état vient du socket ; connexion `offline` si navigateur hors
  // ligne OU socket non connecté (mint échoué / handshake refusé / reconnexion).
  // Le dernier snapshot reste dans socket.tv (repli avec dernier état connu).
  const state: TvState = useMemo(() => {
    if (!isRealtime) return simState;
    const connection = online && socket.connected ? "connected" : "offline";
    return { ...socket.tv, connection };
  }, [isRealtime, simState, socket.tv, socket.connected, online]);

  const mode = useTvMode({ hasActiveCall: state.hero !== null });
  const brand = autoCorrectedBrand(tenant.brand);

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
        locale={tenant.locale}
        tenantName={tenant.name}
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
