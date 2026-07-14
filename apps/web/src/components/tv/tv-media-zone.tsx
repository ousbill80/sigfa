/**
 * TvMediaZone — carrousel de médias dynamiques (images + vidéos) de la zone
 * gauche de l'écran TV d'agence.
 *
 * Piloté par la playlist du manifeste {@link TvMediaItem} (lib/tv-media) :
 * - image : affichée `durationMs` (défaut {@link TV_MEDIA_DEFAULT_DURATION_MS})
 *   puis avance ;
 * - vidéo : `muted autoplay playsInline`, avance à la fin (`ended`) ou après
 *   `durationMs` si fourni ;
 * - fondu croisé {@link TV_MEDIA_FADE_MS} (désactivé en reduced-motion) ;
 * - boucle infinie ; le média suivant est préchargé (couches montées,
 *   `preload` piloté pour les vidéos) ;
 * - un média en échec de chargement est marqué et SAUTÉ proprement ; si tous
 *   échouent, le `fallback` (promo texte AdZone) est rendu — zéro régression.
 *
 * La zone vit sous le bandeau, dans la cellule gauche de la grille split : elle
 * ne recouvre JAMAIS la colonne d'appels (« MAINTENANT SERVI ») — aucun
 * z-index élevé, overflow caché. Présentation pure : aucun contrat temps réel.
 * @module components/tv/tv-media-zone
 */
"use client";

import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  TV_MEDIA_DEFAULT_DURATION_MS,
  TV_MEDIA_FADE_MS,
  type TvMediaItem,
} from "@/lib/tv-media";

/** Props for {@link TvMediaZone}. */
export interface TvMediaZoneProps {
  /** Media playlist (manifest order, looped). */
  items: readonly TvMediaItem[];
  /** Reduced motion — disables the cross-fade (instant swap). */
  reducedMotion?: boolean;
  /** Rendered when the playlist is empty or every media failed to load. */
  fallback?: ReactNode;
}

const rootStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  height: "100%",
  minWidth: 0,
  overflow: "hidden",
  backgroundColor: "var(--night-2, var(--surface-screen))",
};

const layerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
};

const mediaStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

/**
 * Returns the next non-failed index after `from` (looping), or `null` when no
 * playable media remains.
 */
function nextPlayableIndex(
  from: number,
  count: number,
  failed: ReadonlySet<number>
): number | null {
  for (let step = 1; step <= count; step += 1) {
    const candidate = (from + step) % count;
    if (!failed.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Dynamic media carousel of the TV left pane.
 * @param props - {@link TvMediaZoneProps}.
 * @returns The media zone, or the fallback when nothing is playable.
 */
export function TvMediaZone({
  items,
  reducedMotion = false,
  fallback = null,
}: TvMediaZoneProps): ReactElement {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());
  const videoRefs = useRef(new Map<number, HTMLVideoElement>());

  const count = items.length;
  const allFailed = count === 0 || failed.size >= count;
  const current = items[index];
  const nextIndex = nextPlayableIndex(index, Math.max(count, 1), failed);

  const advance = useCallback(() => {
    setIndex((i) => nextPlayableIndex(i, Math.max(count, 1), failed) ?? i);
  }, [count, failed]);

  // Média courant en échec (ou index hors-bornes après rétrécissement) → saute
  // immédiatement vers le prochain média jouable.
  useEffect(() => {
    if (allFailed) return;
    if (current === undefined || failed.has(index)) advance();
  }, [allFailed, current, failed, index, advance]);

  // Minuterie d'avancement : image = durationMs (défaut 8 s) ; vidéo = fin de
  // lecture (`ended`), sauf durationMs explicite qui borne l'affichage.
  useEffect(() => {
    if (allFailed || current === undefined || failed.has(index)) return;
    const durationMs =
      current.type === "image"
        ? (current.durationMs ?? TV_MEDIA_DEFAULT_DURATION_MS)
        : current.durationMs;
    if (durationMs === undefined) return;
    const id = setTimeout(advance, durationMs);
    return () => clearTimeout(id);
  }, [allFailed, current, failed, index, advance]);

  // Pilotage lecture vidéo : seule la vidéo courante joue (reprise au début),
  // les autres sont en pause (préchargées). Tolérant aux environnements sans
  // implémentation média (jsdom) et aux refus d'autoplay.
  useEffect(() => {
    for (const [i, el] of videoRefs.current.entries()) {
      try {
        if (i === index) {
          el.currentTime = 0;
          void (el.play() as Promise<void> | undefined)?.catch(() => {});
        } else {
          el.pause();
        }
      } catch {
        // environnement sans implémentation média — ignoré
      }
    }
  }, [index]);

  const markFailed = useCallback((i: number) => {
    setFailed((prev) => {
      if (prev.has(i)) return prev;
      const next = new Set(prev);
      next.add(i);
      return next;
    });
  }, []);

  if (allFailed) {
    return (
      <div data-testid="tv-media-fallback" style={{ display: "flex", flex: 1, minWidth: 0 }}>
        {fallback}
      </div>
    );
  }

  return (
    <div data-testid="tv-media-zone" style={rootStyle}>
      {items.map((item, i) => {
        if (failed.has(i)) return null;
        const visible = i === index;
        return (
          <div
            key={`${i}-${item.src}`}
            data-testid="tv-media-item"
            data-media-type={item.type}
            data-visible={visible ? "on" : "off"}
            aria-hidden={visible ? undefined : "true"}
            style={{
              ...layerStyle,
              opacity: visible ? 1 : 0,
              transition: reducedMotion
                ? "none"
                : `opacity ${TV_MEDIA_FADE_MS}ms var(--ease)`,
            }}
          >
            {item.type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- médias banque du manifeste (locaux/CDN banque), hors pipeline next/image
              <img
                data-testid="tv-media-image"
                src={item.src}
                alt=""
                style={mediaStyle}
                onError={() => markFailed(i)}
              />
            ) : (
              <video
                data-testid="tv-media-video"
                ref={(el) => {
                  if (el === null) videoRefs.current.delete(i);
                  else videoRefs.current.set(i, el);
                }}
                src={item.src}
                muted
                autoPlay={visible}
                playsInline
                preload={visible || i === nextIndex ? "auto" : "metadata"}
                style={mediaStyle}
                onEnded={() => {
                  // Avance à la fin naturelle SEULEMENT si aucune durée bornée
                  // (sinon la minuterie fait foi) et si la vidéo est visible.
                  if (visible && item.durationMs === undefined) advance();
                }}
                onError={() => markFailed(i)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
