/**
 * useTvMode — repos↔appel state machine for the TV screen.
 *
 * Par défaut l'écran est au REPOS (`rest`) et affiche l'AdZone plein écran.
 * Quand un appel devient actif (`hasActiveCall` : un `ticket:called` a produit
 * un `hero`), l'écran bascule en mode `call` (scène d'appel prioritaire) pendant
 * une fenêtre de `windowMs`. La fenêtre est ré-armée à chaque nouvel appel. À
 * son expiration, si plus aucun appel n'est actif, retour fluide au `rest`.
 *
 * Ce hook NE consomme AUCUN événement : il dérive uniquement du booléen
 * `hasActiveCall` calculé en amont depuis l'état temps réel existant. Le contrat
 * et la logique de sync restent inchangés.
 * @module lib/use-tv-mode
 */
"use client";

import { useEffect, useRef, useState } from "react";

/** Visible top-level mode of the TV screen. */
export type TvMode = "rest" | "call";

/** Window (ms) during which the call scene stays on after the last call. */
export const TV_CALL_WINDOW_MS = 12000 as const;

/** Options for {@link useTvMode}. */
export interface UseTvModeOptions {
  /** Whether a call is currently active (a hero is being served). */
  hasActiveCall: boolean;
  /** Duration to keep the call scene after the last call before resting. */
  windowMs?: number;
}

/**
 * Derives the TV mode from call activity, holding the call scene for a window.
 * @param options - {@link UseTvModeOptions}.
 * @returns The current {@link TvMode}.
 */
export function useTvMode(options: UseTvModeOptions): TvMode {
  const { hasActiveCall, windowMs = TV_CALL_WINDOW_MS } = options;
  const [mode, setMode] = useState<TvMode>(hasActiveCall ? "call" : "rest");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hasActiveCall) {
      // Appel terminé : on NE touche PAS au timer en cours — la scène reste
      // visible jusqu'à l'expiration de la fenêtre, puis bascule au repos.
      return;
    }
    // Nouvel appel actif : (ré)arme la fenêtre et force la scène d'appel.
    if (timerRef.current) clearTimeout(timerRef.current);
    setMode("call");
    timerRef.current = setTimeout(() => {
      setMode("rest");
      timerRef.current = null;
    }, windowMs);
  }, [hasActiveCall, windowMs]);

  // Nettoyage au démontage uniquement (ne pas annuler la fenêtre en cours).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return mode;
}
