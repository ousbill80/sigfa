/**
 * useAdCarousel — rotates through {@link AdSlide}s on a timer.
 *
 * Comportement pur d'affichage (aucun fetch, aucun contrat temps réel touché).
 * L'index avance toutes les `intervalMs` ; testable via fake-timers. La rotation
 * est suspendue quand `active` est faux (ex. l'AdZone n'est pas à l'écran) afin
 * de repartir de la première slide au retour au repos.
 * @module lib/use-ad-carousel
 */
"use client";

import { useEffect, useState } from "react";
import { AD_SLIDE_DURATION_MS, type AdSlide } from "./ad-slides";

/** Options for {@link useAdCarousel}. */
export interface UseAdCarouselOptions {
  /** Slides to rotate through. */
  slides: readonly AdSlide[];
  /** Whether the carousel should be advancing (paused when false). */
  active?: boolean;
  /** Per-slide duration in ms. */
  intervalMs?: number;
}

/** Result of {@link useAdCarousel}. */
export interface UseAdCarouselResult {
  /** Index of the currently displayed slide. */
  index: number;
  /** The currently displayed slide (undefined only when `slides` is empty). */
  current: AdSlide | undefined;
}

/**
 * Rotates through the given slides on an interval.
 * @param options - {@link UseAdCarouselOptions}.
 * @returns {@link UseAdCarouselResult}.
 */
export function useAdCarousel(options: UseAdCarouselOptions): UseAdCarouselResult {
  const { slides, active = true, intervalMs = AD_SLIDE_DURATION_MS } = options;
  const [index, setIndex] = useState(0);
  const count = slides.length;

  // Repart de la première slide dès que la rotation est suspendue, et évite un
  // index hors-bornes si la liste rétrécit.
  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    if (count <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, count, intervalMs]);

  const safeIndex = count === 0 ? 0 : index % count;
  return { index: safeIndex, current: slides[safeIndex] };
}
