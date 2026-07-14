/**
 * usePrefersReducedMotion — suit la préférence `prefers-reduced-motion` du
 * spectateur (écrans publics TV : fondus du carrousel média/pub et flash de la
 * carte d'appel désactivés quand la préférence est active).
 *
 * Sans `matchMedia` (environnements de test/SSR), retourne `false` — les
 * transitions restent alors pilotées par les props explicites des composants.
 * @module lib/use-prefers-reduced-motion
 */
"use client";

import { useEffect, useState } from "react";

/** Media query watched by {@link usePrefersReducedMotion}. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)" as const;

/**
 * Tracks the viewer's reduced-motion preference.
 * @returns `true` when the OS asks for reduced motion.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = (): void => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}
