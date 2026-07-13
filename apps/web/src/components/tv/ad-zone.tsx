/**
 * AdZone — advertising/media carousel of the TV split layout (TV v3). Elle vit
 * EN PERMANENCE dans la zone gauche (~75 %) sous le bandeau global : soft
 * cross-fade entre slides banque + ligne d'accueil en pied. Elle ne rend PLUS
 * de header propre (nom banque/horloge sont portés par le bandeau TvScreen) et
 * remplit son conteneur (plus de plein écran autonome).
 *
 * Présentation pure : pilotée par une liste de slides configurable
 * ({@link AdSlide}) ; aucun fetch, aucune image réseau externe (les slides de
 * démo sont composées en tokens). La gestion réelle des médias (upload banque)
 * = future story admin, HORS SCOPE ici.
 * @module components/tv/ad-zone
 */
"use client";

import type { CSSProperties, ReactElement } from "react";
import { t, type Locale } from "@/lib/i18n";
import { AD_FADE_MS, DEFAULT_AD_SLIDES, type AdSlide } from "@/lib/ad-slides";
import { useAdCarousel } from "@/lib/use-ad-carousel";

/** Props for {@link AdZone}. */
export interface AdZoneProps {
  /** Slides to rotate through (defaults to demo slides). */
  slides?: readonly AdSlide[];
  /** Active locale for the slide copy + footer. */
  locale?: Locale;
  /** Whether the AdZone is on screen (drives/pauses the carousel). */
  active?: boolean;
  /** Reduced motion — disables the cross-fade transition. */
  reducedMotion?: boolean;
}

const rootStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  height: "100%",
  minWidth: 0,
  overflow: "hidden",
  /* Grille « billboard » : contenu centré / footer (bas). Les rangées sont
     DISTINCTES → jamais de chevauchement, même titre long. Le header global
     (banque + date + horloge) est porté par TvScreen, pas par l'AdZone. */
  display: "grid",
  gridTemplateRows: "1fr auto",
  backgroundColor: "var(--night-2, var(--surface-screen))",
  color: "var(--ink-inverse)",
  fontFamily: "var(--font-text)",
};

/**
 * Titre du slide : taille BORNÉE (clamp) au lieu du hero fixe 180px, pour que
 * même un titre long (« Ouvrez un compte en 10 minutes ») tienne en 16:9 sans
 * déborder sur les overlays. Interlignage serré + équilibrage des lignes.
 */
const AD_TITLE_FONT_SIZE = "clamp(2.75rem, 6.2vw, 6rem)" as const;
const AD_SUBTITLE_FONT_SIZE = "clamp(1.375rem, 2.4vw, 2.4375rem)" as const;

/**
 * Container-filling AdZone carousel (permanent left pane of the TV split).
 * @param props - {@link AdZoneProps}.
 * @returns The AdZone element.
 */
export function AdZone({
  slides = DEFAULT_AD_SLIDES,
  locale = "fr",
  active = true,
  reducedMotion = false,
}: AdZoneProps): ReactElement {
  const { index, current } = useAdCarousel({ slides, active });

  return (
    <div data-testid="tv-adzone" data-active={active ? "on" : "off"} style={rootStyle}>
      {/* Fonds plein-cadre empilés (dégradés/médias) ; opacité pilotée pour le
          fondu croisé. Ils vivent DERRIÈRE la grille (couche z séparée) et ne
          portent PLUS le texte → le contenu textuel reste borné à la rangée
          centrale, sans jamais chevaucher header/footer. */}
      <div
        data-testid="tv-adzone-stage"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      >
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            data-testid="tv-adslide"
            data-slide-id={slide.id}
            data-visible={i === index ? "on" : "off"}
            style={{
              position: "absolute",
              inset: 0,
              background: slide.bg,
              opacity: i === index ? 1 : 0,
              transition: reducedMotion ? "none" : `opacity ${AD_FADE_MS}ms var(--ease)`,
            }}
          >
            {slide.imageUrl !== undefined && (
              // eslint-disable-next-line @next/next/no-img-element -- local bank media only, never external network
              <img
                data-testid="tv-adslide-image"
                src={slide.imageUrl}
                alt=""
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Rangée centrale : le contenu du slide actif, CENTRÉ verticalement dans
          l'espace SÛR au-dessus du footer. Padding généreux → marges autour
          du titre. Le titre est borné (clamp) donc un titre long reste dans la
          zone sans jamais toucher les overlays. */}
      <div
        data-testid="tv-adzone-content"
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: "var(--space-6)",
          padding: "var(--space-8) var(--space-24)",
          overflow: "hidden",
        }}
      >
        {current !== undefined && (
          <>
            {/* Eyebrow discret — repère « billboard » premium, sans image ni
                texte réseau (pur token). Marque l'espace publicitaire. */}
            <span
              data-testid="tv-adslide-eyebrow"
              aria-hidden="true"
              style={{
                width: "var(--space-16)",
                height: "var(--space-1)",
                borderRadius: "var(--r-full)",
                background: current.accent ?? "var(--gold)",
                opacity: 0.9,
              }}
            />
            <div
              data-testid="tv-adslide-title"
              data-slide-id={current.id}
              style={{
                fontSize: AD_TITLE_FONT_SIZE,
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                lineHeight: 1.05,
                letterSpacing: "var(--tracking-tight)",
                color: current.accent ?? "var(--gold)",
                maxWidth: "18ch",
                textWrap: "balance",
              }}
            >
              {t(current.titleKey, locale)}
            </div>
            {current.subtitleKey !== undefined && (
              <div
                data-testid="tv-adslide-subtitle"
                style={{
                  fontSize: AD_SUBTITLE_FONT_SIZE,
                  lineHeight: "var(--leading-tight)",
                  color: "var(--ink-inverse)",
                  maxWidth: "34ch",
                  textWrap: "balance",
                }}
              >
                {t(current.subtitleKey, locale)}
              </div>
            )}
          </>
        )}
      </div>

      <footer
        data-testid="tv-adzone-footer"
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          padding: "var(--space-8) var(--space-12) var(--space-12)",
          fontSize: "var(--text-xl)",
          color: "var(--ink-inverse-soft)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: "var(--space-3)",
            height: "var(--space-3)",
            borderRadius: "var(--r-full)",
            backgroundColor: "var(--forest)",
            boxShadow: "0 0 var(--space-4) var(--forest)",
          }}
        />
        <span style={{ fontWeight: 600, color: "var(--ink-inverse)" }}>{t("tv.welcome", locale)}</span>
        <span aria-hidden="true">·</span>
        <span>{t("tv.queue_in_progress", locale)}</span>
      </footer>
    </div>
  );
}
