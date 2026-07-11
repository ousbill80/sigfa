/**
 * useTvSimulation — drives the TV display from simulated realtime events.
 * RT-001 keeps sockets inactive; this hook exposes an imperative API so tests
 * (and the page shell) can feed ticket:called / sync:state / connection events.
 *
 * TV-001 scope: state reduction + connection.
 * TV-002 scope: 2s brand flash, double gong (Web Audio), voice announcement
 * (Web Speech), burst queueing (<500ms), and offline→resync via
 * sync:state.recentCalls without flash/gong.
 * @module lib/use-tv-simulation
 */
"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { tvReducer, type TvState, type TvAction } from "./tv-state";
import type { Locale } from "./i18n";
import {
  playDoubleGong,
  announceCall,
  type AudioLike,
  type SpeechLike,
} from "./tv-audio";

/** Duration of the brand flash on ticket:called (TV-002): 2s exactes. */
export const TV_FLASH_MS = 2000 as const;

/** Options for {@link useTvSimulation}. */
export interface UseTvSimulationOptions {
  /** Initial seed state. */
  seed: TvState;
  /** Locale used for the voice announcement. */
  locale?: Locale;
  /** Injectable AudioContext factory (tests). Defaults to Web Audio. */
  audioFactory?: () => AudioLike | null;
  /** Injectable speech synthesis (tests). Defaults to window.speechSynthesis. */
  speech?: SpeechLike | null;
  /** Volume 0–1 for the gong (tenant default 0.8). */
  volume?: number;
  /** Whether reduced motion is preferred (disables flash/slide). */
  reducedMotion?: boolean;
}

/** Result of {@link useTvSimulation}. */
export interface UseTvSimulationResult {
  /** The current TV state. */
  state: TvState;
  /** Whether the brand flash is currently active. */
  celebration: boolean;
  /** Dispatch a ticket:called event (queued if a burst is in progress). */
  callTicket: (payload: unknown) => void;
  /** Apply a sync:state payload (resync; no flash/gong). */
  resync: (payload: unknown) => void;
  /** Set the connection status. */
  setConnection: (status: "connected" | "offline") => void;
}

/** Default Web Audio factory (browser). */
function defaultAudioFactory(): AudioLike | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as unknown as { AudioContext?: new () => AudioLike }).AudioContext ??
    (window as unknown as { webkitAudioContext?: new () => AudioLike }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/** Default speech synthesis (browser). */
function defaultSpeech(): SpeechLike | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { speechSynthesis?: SpeechLike }).speechSynthesis ?? null;
}

/**
 * Hook that drives the TV display and side-effects (flash/gong/voice) from
 * simulated realtime events.
 * @param options - {@link UseTvSimulationOptions}.
 * @returns {@link UseTvSimulationResult}.
 */
export function useTvSimulation(options: UseTvSimulationOptions): UseTvSimulationResult {
  const { seed, locale = "fr", audioFactory, speech, volume = 0.8, reducedMotion = false } = options;

  const [state, dispatch] = useReducer(tvReducer, seed);
  const [celebration, setCelebration] = useState(false);

  // Burst queue : events arriving <500ms apart are played sequentially.
  const queueRef = useRef<unknown[]>([]);
  const processingRef = useRef(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const audioFactoryResolved = audioFactory ?? defaultAudioFactory;
  const speechResolved = speech !== undefined ? speech : null;

  const getSpeech = useCallback((): SpeechLike | null => {
    return speechResolved ?? defaultSpeech();
  }, [speechResolved]);

  /** Plays flash + gong + voice for a single validated call and advances the queue. */
  const runEffects = useCallback(
    (payload: unknown): void => {
      dispatch({ type: "ticket:called", payload });

      // Flash brand pendant TV_FLASH_MS (désactivé si reduced-motion).
      if (!reducedMotion) {
        setCelebration(true);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setCelebration(false), TV_FLASH_MS);
      }

      // Double gong (Web Audio) — best-effort.
      const ctx = audioFactoryResolved();
      if (ctx) playDoubleGong(ctx, volume);

      // Annonce vocale (Web Speech) — best-effort, échec toléré.
      const spoken = getSpeech();
      if (spoken) {
        const parsed = payload as { ticket?: { number?: string }; counter?: { label?: string } };
        if (parsed?.ticket?.number && parsed?.counter?.label) {
          announceCall(spoken, parsed.ticket.number, parsed.counter.label, locale);
        }
      }
    },
    [audioFactoryResolved, getSpeech, locale, reducedMotion, volume],
  );

  const processQueue = useCallback((): void => {
    if (processingRef.current) return;
    const next = queueRef.current.shift();
    if (next === undefined) return;
    processingRef.current = true;
    runEffects(next);
    // Sérialise le burst : la prochaine annonce démarre après le flash.
    const gap = reducedMotion ? 0 : TV_FLASH_MS;
    setTimeout(() => {
      processingRef.current = false;
      processQueue();
    }, gap);
  }, [reducedMotion, runEffects]);

  const callTicket = useCallback(
    (payload: unknown): void => {
      queueRef.current.push(payload);
      processQueue();
    },
    [processQueue],
  );

  const resync = useCallback((payload: unknown): void => {
    // Reconstruit l'affichage sans flash ni gong (pas un nouvel appel).
    dispatch({ type: "sync:state", payload });
  }, []);

  const setConnection = useCallback((status: "connected" | "offline"): void => {
    dispatch({ type: "connection", status } as TvAction);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  return useMemo(
    () => ({ state, celebration, callTicket, resync, setConnection }),
    [state, celebration, callTicket, resync, setConnection],
  );
}
