/**
 * TvDisplay — orchestration de l'affichage TV split permanent (TV v3 + RT-003).
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
 * TV v3 (design-gate PO 2026-07-13, réf. BNI) : plus de bascule repos↔appel —
 * {@link TvScreen} affiche pub ET colonne d'appels en permanence. Ce composant
 * n'ajoute QUE la logique de données/connexion + l'horodatage (horloge + date
 * complète FR/EN). La logique temps réel est INCHANGÉE.
 *
 * Mode public (demandes PO écran TV) :
 * - **Plein écran natif** : bouton discret dans le coin du bandeau (la
 *   Fullscreen API exige un geste utilisateur — pas d'auto-fullscreen
 *   possible) ; en exploitation définitive, lancer le navigateur en kiosque :
 *   `chrome --kiosk --autoplay-policy=no-user-gesture-required <url>`.
 * - **Curseur masqué** après inactivité (écran public).
 * - **Takeover appel** : au `ticket:called`, le numéro passe en grand au
 *   centre (overlay ~7 s, file sans chevauchement) avec annonce vocale
 *   « Ticket {numéro épelé}, {guichet} » — coupable via `?muted=1`.
 *
 * @module components/tv/tv-display
 */
"use client";

import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { TvScreen } from "@/components/tv/tv-screen";
import { TvCallOverlay } from "@/components/tv/tv-call-overlay";
import { useTvCallOverlay, parseTvMuted } from "@/components/tv/use-tv-call-overlay";
import {
  TvFullscreenButton,
  useTvFullscreen,
  useTvIdleCursor,
} from "@/components/tv/tv-fullscreen";
import { useTvClock } from "@/lib/use-tv-clock";
import { useTvMediaManifest } from "@/lib/use-tv-media";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { useTvSimulation } from "@/lib/use-tv-simulation";
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
  /**
   * URL du logo banque (convention lib/bank-branding, résolue côté serveur par
   * la page). `null`/absent → pastille --brand + initiale.
   */
  logoUrl?: string | null;
}

/** Props de {@link TvDisplay}. */
export interface TvDisplayProps {
  /** Theming du tenant. */
  tenant: TvTenant;
}

/**
 * Formate la date complète du bandeau TV (jour de semaine + jour + mois +
 * année), localisée FR/EN, première lettre capitalisée (le français rend les
 * jours en minuscules).
 * @param date - La date à formater.
 * @param locale - La langue d'affichage.
 * @returns La date complète localisée (ex. « Lundi 13 juillet 2026 »).
 */
export function formatTvDate(date: Date, locale: Locale): string {
  const formatted = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/**
 * Écran TV split permanent, piloté par le socket (real) ou la simulation (off).
 * @param props - {@link TvDisplayProps}.
 * @returns L'élément d'affichage.
 */
export function TvDisplay({ tenant }: TvDisplayProps): ReactElement {
  const clock = useTvClock();
  const socket = useSocket();
  // Zone média gauche : playlist du manifeste public/tv-media (vide → repli
  // promo texte) ; fondus désactivés si le spectateur préfère moins de motion.
  const mediaItems = useTvMediaManifest();
  const reducedMotion = usePrefersReducedMotion();
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

  // Date complète du bandeau — dérivée du tick horloge (rendu client only,
  // comme l'horloge : chaîne vide côté serveur → pas de mismatch d'hydratation).
  const dateLabel = useMemo(
    () => (clock === "" ? "" : formatTvDate(new Date(), tenant.locale)),
    [clock, tenant.locale],
  );

  // Réglage d'exploitation `?muted=1` — lu côté client uniquement (pas de
  // useSearchParams : évite la contrainte Suspense, aucun mismatch : le son
  // n'a pas de rendu serveur).
  const muted = useTvMuted();

  // Takeover « numéro appelé plein centre » + annonce vocale (file, ~7 s).
  const { overlay, closing } = useTvCallOverlay({
    state,
    locale: tenant.locale,
    muted,
  });

  // Plein écran natif (geste requis) + curseur masqué après inactivité.
  const { isFullscreen, toggle } = useTvFullscreen();
  const idle = useTvIdleCursor();

  const brand = autoCorrectedBrand(tenant.brand);

  return (
    <div
      data-testid="tv-root"
      data-realtime={isRealtime ? "on" : "off"}
      data-idle={idle ? "on" : "off"}
      style={
        {
          "--brand": brand,
          backgroundColor: "var(--night-2, var(--surface-screen))",
          minHeight: "100vh",
          /* Écran public : le curseur disparaît après inactivité. */
          cursor: idle ? "none" : undefined,
        } as React.CSSProperties
      }
    >
      <TvScreen
        state={state}
        locale={tenant.locale}
        tenantName={tenant.name}
        clock={clock}
        dateLabel={dateLabel}
        /* La carte « MAINTENANT SERVI » flashe pendant le takeover (real) —
           mécanique celebration simulée inchangée en mode off. */
        celebration={overlay !== null || (!isRealtime && celebration)}
        reducedMotion={reducedMotion}
        mediaItems={mediaItems}
        logoUrl={tenant.logoUrl ?? null}
        headerAction={
          <TvFullscreenButton
            isFullscreen={isFullscreen}
            hidden={idle}
            onToggle={toggle}
            locale={tenant.locale}
          />
        }
      />
      {overlay !== null && (
        <TvCallOverlay
          call={overlay}
          locale={tenant.locale}
          closing={closing}
          reducedMotion={reducedMotion}
        />
      )}
    </div>
  );
}

/**
 * Lit `?muted=1` (coupe l'annonce vocale) depuis l'URL, côté client
 * uniquement — réglage d'exploitation de l'écran public.
 * @returns `true` si le son est coupé.
 */
function useTvMuted(): boolean {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    setMuted(parseTvMuted(window.location.search));
  }, []);
  return muted;
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
