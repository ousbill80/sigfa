/**
 * useTvCallOverlay — file d'overlays « numéro appelé plein centre » + annonce
 * vocale, pilotée par les transitions d'état TV (`ticket:called`).
 *
 * Demande PO (écran TV public) : quand un `ticket:called` arrive, le numéro
 * passe EN GRAND AU CENTRE (takeover ~6-8 s) puis retour fluide au split ; les
 * appels qui s'enchaînent sont mis en FILE (jamais de chevauchement) ; pendant
 * l'overlay la synthèse vocale annonce « Ticket {numéro épelé}, {guichet} »
 * (coupable via `?muted=1`).
 *
 * Détection d'un APPEL LIVE (vs resync) sans toucher au socket-provider
 * (zone TV uniquement — chantiers parallèles sur les libs partagées) : le
 * reducer {@link tvReducer} a une signature structurelle distincte par action —
 *   - `ticket:called` : l'ancien hero GLISSE en `previous[0]` (MÊME référence
 *     objet), ou `previous` est réutilisé tel quel (même référence tableau)
 *     quand l'écran n'avait pas de hero ;
 *   - `sync:state` : TOUS les objets sont reconstruits (aucune référence
 *     partagée) → jamais d'overlay ni d'annonce au (re)sync, conforme à la
 *     mécanique TV-002 (resync sans flash/gong).
 * Ce couplage au reducer est PINNÉ par les tests (`isLiveCallTransition`
 * confronté à `tvReducer` réel).
 *
 * @module components/tv/use-tv-call-overlay
 */
"use client";

import { useEffect, useRef, useState } from "react";
import type { TvCall, TvState } from "@/lib/tv-state";
import type { Locale } from "@/lib/i18n";
import {
  speakTvAnnouncement,
  tvAnnouncementText,
  type TvSpeechSynthesisLike,
} from "./tv-voice";

/** Durée d'affichage pleine visibilité d'un overlay (fenêtre PO 6-8 s). */
export const TV_OVERLAY_MS = 7000 as const;

/** Durée de la sortie fluide (fondu) avant le retour au split. */
export const TV_OVERLAY_EXIT_MS = 360 as const;

/** Respiration entre deux overlays enchaînés (jamais de chevauchement). */
export const TV_OVERLAY_GAP_MS = 400 as const;

/**
 * Appels LIVE (`ticket:called`) contenus dans la transition `prev → next`,
 * du plus ancien au plus récent — vide pour un resync (`sync:state`), un
 * simple changement de connexion, ou le premier état observé.
 *
 * S'appuie sur les invariants de référence du reducer (voir doc du module) et
 * gère le batch React (plusieurs `ticket:called` réduits dans un même rendu :
 * l'ancien hero a glissé PLUS BAS dans `previous`, les entrées au-dessus sont
 * les appels intermédiaires). Cas dégénéré accepté : plus d'appels batchés que
 * de places dans `previous` → l'ancien hero est sorti de la liste, transition
 * ignorée (identique à un resync — l'affichage colonne reste juste).
 * @param prev - État TV précédent.
 * @param next - État TV suivant.
 * @returns Les nouveaux appels, en ordre chronologique (peut être vide).
 */
export function liveCallsInTransition(prev: TvState, next: TvState): TvCall[] {
  if (next.hero === null || next.hero === prev.hero) return [];
  if (prev.hero === null) {
    // Écran sans hero : `ticket:called` réutilise `previous` TEL QUEL (même
    // référence tableau) — `sync:state` reconstruit tout.
    return next.previous === prev.previous ? [next.hero] : [];
  }
  const slidIndex = next.previous.indexOf(prev.hero);
  if (slidIndex === -1) return [];
  // Batch : les entrées AU-DESSUS de l'ancien hero (plus récentes d'abord)
  // sont les appels intermédiaires → remis en ordre chronologique.
  return [...next.previous.slice(0, slidIndex).reverse(), next.hero];
}

/**
 * Vrai si la transition `prev → next` contient au moins un appel live.
 * @param prev - État TV précédent.
 * @param next - État TV suivant.
 * @returns `true` si un nouvel appel vient d'arriver.
 */
export function isLiveCallTransition(prev: TvState, next: TvState): boolean {
  return liveCallsInTransition(prev, next).length > 0;
}

/** Options de {@link useTvCallOverlay}. */
export interface UseTvCallOverlayOptions {
  /** État TV courant (socket en real, simulation en off). */
  state: TvState;
  /** Locale de l'annonce vocale. */
  locale: Locale;
  /** Son coupé (`?muted=1`) — l'overlay visuel reste. */
  muted: boolean;
  /** Durée pleine visibilité (défaut {@link TV_OVERLAY_MS}). */
  durationMs?: number;
  /** Synthèse injectable (tests). Défaut : `window.speechSynthesis`. */
  speech?: TvSpeechSynthesisLike | null;
}

/** Résultat de {@link useTvCallOverlay}. */
export interface UseTvCallOverlayResult {
  /** Overlay actif (numéro plein centre), ou null (mise en page normale). */
  overlay: TvCall | null;
  /** Vrai pendant la fenêtre de sortie fluide (fondu avant retrait). */
  closing: boolean;
}

/** `window.speechSynthesis` du navigateur (null hors navigateur). */
function defaultSpeech(): TvSpeechSynthesisLike | null {
  if (typeof window === "undefined") return null;
  return (window as { speechSynthesis?: TvSpeechSynthesisLike }).speechSynthesis ?? null;
}

/**
 * File d'overlays takeover + annonce vocale sur `ticket:called`.
 * @param options - {@link UseTvCallOverlayOptions}.
 * @returns {@link UseTvCallOverlayResult}.
 */
export function useTvCallOverlay(options: UseTvCallOverlayOptions): UseTvCallOverlayResult {
  const { state, locale, muted, durationMs = TV_OVERLAY_MS, speech } = options;

  const [pending, setPending] = useState<readonly TvCall[]>([]);
  const [overlay, setOverlay] = useState<TvCall | null>(null);
  const [closing, setClosing] = useState(false);
  const prevStateRef = useRef<TvState | null>(null);
  // Respiration UNIQUEMENT entre deux overlays (le premier part immédiatement).
  const hadOverlayRef = useRef(false);

  // 1. Détection des appels live → enfilage (jamais de chevauchement).
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    // Premier état observé (montage / snapshot initial) : jamais d'overlay.
    if (prev === null || prev === state) return;
    const calls = liveCallsInTransition(prev, state);
    if (calls.length > 0) {
      setPending((queue) => [...queue, ...calls]);
    }
  }, [state]);

  // 2. Défilement de la file : un overlay à la fois, respiration entre deux.
  useEffect(() => {
    if (overlay !== null || pending.length === 0) return;
    const next = pending[0] as TvCall;
    const delay = hadOverlayRef.current ? TV_OVERLAY_GAP_MS : 0;
    const timer = setTimeout(() => {
      setPending((queue) => queue.slice(1));
      setClosing(false);
      setOverlay(next);
    }, delay);
    return () => clearTimeout(timer);
  }, [overlay, pending]);

  // 3. Cycle de vie d'un overlay : annonce vocale à l'entrée, sortie fluide
  //    (closing) après durationMs, retrait après TV_OVERLAY_EXIT_MS.
  useEffect(() => {
    if (overlay === null) return;
    hadOverlayRef.current = true;

    if (!muted) {
      // Best-effort : bloqué avant toute interaction utilisateur (autoplay)
      // → silence gracieux, l'overlay visuel reste la garantie.
      speakTvAnnouncement(speech !== undefined ? speech : defaultSpeech(), {
        locale,
        text: tvAnnouncementText(overlay.displayNumber, overlay.counterLabel, locale),
      });
    }

    const closeTimer = setTimeout(() => setClosing(true), durationMs);
    const removeTimer = setTimeout(() => {
      setClosing(false);
      setOverlay(null);
    }, durationMs + TV_OVERLAY_EXIT_MS);
    return () => {
      clearTimeout(closeTimer);
      clearTimeout(removeTimer);
    };
  }, [overlay, muted, locale, durationMs, speech]);

  return { overlay, closing };
}

/**
 * Lit le réglage son de l'écran TV depuis la query string : `?muted=1` (ou
 * `muted=true`) coupe l'annonce vocale — réglage d'exploitation documenté.
 * @param search - `location.search` (ex. `?muted=1`).
 * @returns `true` si le son est coupé.
 */
export function parseTvMuted(search: string): boolean {
  const value = new URLSearchParams(search).get("muted");
  return value === "1" || value === "true";
}
