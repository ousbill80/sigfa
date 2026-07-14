/**
 * AUDIT-F7 — useScrollAffordance.ts
 * Mesure une région scrollable et expose `canScrollDown` : vrai tant qu'il
 * reste du contenu SOUS le pli, faux en fin de scroll.
 *
 * Un client debout devant la borne ne devine pas qu'un écran défile (audit UX
 * borne 2026-07-14, F7) : ce hook pilote l'affordance visuelle (dégradé de
 * bord + chevron) qui l'indique et DISPARAÎT en fin de scroll.
 *
 * Re-mesure : au scroll (brancher `onScroll` sur la région), au resize
 * fenêtre, aux variations de taille observées (ResizeObserver, si présent) et
 * à la demande via `recompute` (contenu qui change : « voir plus », données).
 */
"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Tolérance de fin de scroll (arrondis sous-pixel des moteurs de rendu). */
const SCROLL_END_EPSILON_PX = 8;

export interface ScrollAffordance<T extends HTMLElement> {
  /** À poser sur la région scrollable. */
  scrollRef: RefObject<T | null>;
  /** Vrai tant qu'il reste du contenu sous le pli. */
  canScrollDown: boolean;
  /** À brancher sur l'événement `onScroll` de la région. */
  onScroll: () => void;
  /** Re-mesure à la demande (contenu déplié, données arrivées…). */
  recompute: () => void;
}

export function useScrollAffordance<T extends HTMLElement>(): ScrollAffordance<T> {
  const scrollRef = useRef<T | null>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setCanScrollDown(false);
      return;
    }
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    setCanScrollDown(remaining > SCROLL_END_EPSILON_PX);
  }, []);

  useEffect(() => {
    recompute();
    window.addEventListener("resize", recompute);

    // Suit les variations de taille de la région ET de son contenu (fonts
    // chargées, cartes ajoutées) quand ResizeObserver existe (Electron : oui).
    let observer: ResizeObserver | undefined;
    const el = scrollRef.current;
    if (typeof ResizeObserver !== "undefined" && el) {
      observer = new ResizeObserver(recompute);
      observer.observe(el);
      if (el.firstElementChild) {
        observer.observe(el.firstElementChild);
      }
    }

    return () => {
      window.removeEventListener("resize", recompute);
      observer?.disconnect();
    };
  }, [recompute]);

  return { scrollRef, canScrollDown, onScroll: recompute, recompute };
}
