/**
 * TvCallOverlay — takeover « numéro appelé plein centre » de l'écran TV.
 *
 * Demande PO : au `ticket:called`, le numéro passe EN GRAND AU CENTRE de
 * l'écran, par-dessus tout : voile plein écran sur la surface écran TV
 * (--surface-screen ≙ --night-2, assombri via color-mix — aucun hex en dur),
 * numéro géant centré (MÊME règle qu'ailleurs : UNE ligne, nowrap + taille
 * adaptative en cqw par caractère), « Guichet N » bien lisible dessous, halo
 * brand-inv (halo digne). Entrée en fondu/échelle sur tokens de durée,
 * sortie fluide pilotée par `closing` ; `prefers-reduced-motion` → aucune
 * transition (apparition/disparition instantanées).
 *
 * Présentationnel pur : la file, la durée (~6-8 s) et l'annonce vocale vivent
 * dans {@link useTvCallOverlay}.
 *
 * @module components/tv/tv-call-overlay
 */
"use client";

import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import type { TvCall } from "@/lib/tv-state";
import { t, type Locale } from "@/lib/i18n";

/**
 * Taille du numéro takeover — même règle que la carte colonne (TV-NOWRAP,
 * pente PAR CARACTÈRE) transposée au plein écran : budget ~80 cqw de la
 * LARGEUR ÉCRAN réparti sur la longueur du numéro (UNE ligne garantie à toutes
 * résolutions TV), borné par tokens : plancher --display-tv-counter (géant
 * garanti), plafond 2 × --display-tv-hero (dérivé de token, aucune taille en
 * dur nouvelle).
 * @param displayNumber - Le numéro affiché (ex. « OC-001 »).
 * @returns La taille de police CSS adaptative (clamp bornée par tokens).
 */
export function overlayNumberFontSize(displayNumber: string): string {
  const chars = Math.max(displayNumber.length, 1);
  const perCharCqw = Math.floor(80 / chars);
  return `clamp(var(--display-tv-counter), ${perCharCqw}cqw, calc(var(--display-tv-hero) * 2))`;
}

/** Props de {@link TvCallOverlay}. */
export interface TvCallOverlayProps {
  /** L'appel affiché plein centre. */
  call: TvCall;
  /** Locale des libellés. */
  locale: Locale;
  /** Fenêtre de sortie fluide (fondu avant retrait par le parent). */
  closing?: boolean;
  /** Préférence reduced-motion : aucune transition. */
  reducedMotion?: boolean;
}

/** Voile plein écran — surface écran TV assombrie, par-dessus tout. */
const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 40,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  gap: "var(--space-6)",
  padding: "var(--space-8)",
  /* Assombrissement dérivé du token nuit (pas de rgba en dur) : la pub reste
     devinable en transparence, le numéro écrase tout en lisibilité. */
  backgroundColor: "color-mix(in srgb, var(--night-2, var(--surface-screen)) 92%, transparent)",
  color: "var(--ink-inverse)",
  /* Le numéro se dimensionne en cqw sur la largeur RÉELLE de l'écran. */
  containerType: "inline-size",
};

/**
 * Overlay takeover du numéro appelé (plein centre, par-dessus tout).
 * @param props - {@link TvCallOverlayProps}.
 * @returns L'élément overlay.
 */
export function TvCallOverlay({
  call,
  locale,
  closing = false,
  reducedMotion = false,
}: TvCallOverlayProps): ReactElement {
  // Entrée en fondu/échelle : monté → visible au tick suivant (transition CSS).
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    setEntered(true);
  }, []);

  const visible = entered && !closing;

  return (
    <div
      data-testid="tv-call-overlay"
      data-closing={closing ? "on" : "off"}
      role="status"
      aria-live="assertive"
      style={{
        ...backdropStyle,
        opacity: reducedMotion ? 1 : visible ? 1 : 0,
        transition: reducedMotion
          ? "none"
          : "opacity var(--dur-3) var(--ease)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-4)",
          transform: reducedMotion || visible ? "scale(1)" : "scale(0.94)",
          transition: reducedMotion ? "none" : "transform var(--dur-3) var(--ease)",
        }}
      >
        <div
          data-testid="tv-overlay-label"
          style={{
            fontSize: "var(--text-2xl)",
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--ink-inverse-soft)",
          }}
        >
          {t("tv.now_serving", locale)}
        </div>
        <div
          data-testid="tv-overlay-number"
          style={{
            /* UNE ligne, toujours — même règle que la carte colonne. */
            whiteSpace: "nowrap",
            fontSize: overlayNumberFontSize(call.displayNumber),
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            lineHeight: "var(--leading-tight)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "var(--tracking-numeric)",
            color: "var(--ink-inverse)",
            /* Halo brand-inv — même pattern que TicketMoment. */
            textShadow:
              "0 0 48px color-mix(in srgb, var(--brand-inv) 30%, transparent)",
          }}
        >
          {call.displayNumber}
        </div>
        <div
          data-testid="tv-overlay-counter"
          style={{
            fontSize: "var(--display-tv)",
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            lineHeight: "var(--leading-tight)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--brand-inv)",
            whiteSpace: "nowrap",
          }}
        >
          {call.counterLabel}
        </div>
      </div>
    </div>
  );
}
