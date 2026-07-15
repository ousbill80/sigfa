/**
 * TvMediaZone — carrousel de médias dynamiques (images + vidéos) de la zone
 * gauche de l'écran TV d'agence.
 *
 * Piloté par la playlist du manifeste {@link TvMediaItem} (lib/tv-media) :
 * - image / vidéo : `object-fit: cover` (plein cadre du split ~4:3) ;
 * - fondu croisé {@link TV_MEDIA_FADE_MS} (désactivé en reduced-motion) ;
 * - overlays Neutre Premium (lave brand haute + vignette nuit + lavette papier
 *   vers la colonne claire) pour marier le média avec bandeau et colonne ;
 * - pastilles --brand-inv de progression ;
 * - boucle infinie ; média suivant préchargé ; échec → skip / fallback AdZone.
 *
 * Aucun z-index élevé : la colonne d'appels n'est jamais masquée.
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
  /* Base nuit tiédie brand — jamais un noir froid sous les slides. */
  backgroundColor: "color-mix(in srgb, var(--brand) 10%, var(--night-2))",
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
  objectPosition: "center",
  display: "block",
};

/** Lave brand haute — jointure visuelle avec le bandeau #1d4ed8 (repli produit). */
const washTopStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--brand) 28%, transparent) 0%, transparent 28%)",
};

/** Vignette nuit chaude — cadre le sujet sans le noyer. */
const vignetteStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  background:
    "radial-gradient(ellipse at 48% 42%, transparent 40%, color-mix(in srgb, var(--night-2) 58%, transparent) 100%)",
};

/** Lavette droite — adoucit le cut noir/crème vers la colonne --paper. */
const washRightStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  background:
    "linear-gradient(90deg, transparent 78%, color-mix(in srgb, var(--paper) 14%, transparent) 100%)",
};

const progressStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: "var(--space-6)",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  pointerEvents: "none",
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
  const playableCount = items.reduce((n, _item, i) => (failed.has(i) ? n : n + 1), 0);

  const advance = useCallback(() => {
    setIndex((i) => nextPlayableIndex(i, Math.max(count, 1), failed) ?? i);
  }, [count, failed]);

  useEffect(() => {
    if (allFailed) return;
    if (current === undefined || failed.has(index)) advance();
  }, [allFailed, current, failed, index, advance]);

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
        const imageDurationMs = item.durationMs ?? TV_MEDIA_DEFAULT_DURATION_MS;
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
                style={{
                  ...mediaStyle,
                  transform: visible && !reducedMotion ? "scale(1.04)" : "scale(1)",
                  transition: reducedMotion
                    ? "none"
                    : `transform ${imageDurationMs}ms linear`,
                }}
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
                  if (visible && item.durationMs === undefined) advance();
                }}
                onError={() => markFailed(i)}
              />
            )}
          </div>
        );
      })}

      <div data-testid="tv-media-wash-top" aria-hidden="true" style={washTopStyle} />
      <div data-testid="tv-media-vignette" aria-hidden="true" style={vignetteStyle} />
      <div data-testid="tv-media-wash-right" aria-hidden="true" style={washRightStyle} />

      {playableCount > 1 && (
        <div data-testid="tv-media-progress" aria-hidden="true" style={progressStyle}>
          {items.map((item, i) => {
            if (failed.has(i)) return null;
            const active = i === index;
            return (
              <span
                key={`${i}-${item.src}-dot`}
                data-testid="tv-media-dot"
                data-active={active ? "on" : "off"}
                style={{
                  display: "block",
                  width: active ? "var(--space-6)" : "var(--space-2)",
                  height: "var(--space-2)",
                  borderRadius: "var(--r-full)",
                  backgroundColor: active
                    ? "var(--brand-inv)"
                    : "color-mix(in srgb, var(--ink-inverse) 32%, transparent)",
                  boxShadow: active ? "0 0 48px color-mix(in srgb, var(--brand-inv) 30%, transparent)" : undefined,
                  transition: reducedMotion
                    ? "none"
                    : `width var(--dur-2) var(--ease), background-color var(--dur-2) var(--ease)`,
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
