/**
 * AdZone — full-screen advertising/media carousel shown when the TV is at rest
 * (no active call). Premium waiting-room presentation: soft cross-fade between
 * bank promo slides, discreet overlay (bank logo/name + clock + a welcome line).
 *
 * Présentation pure : pilotée par une liste de slides configurable
 * ({@link AdSlide}) et l'horloge fournie ; aucun fetch, aucune image réseau
 * externe (les slides de démo sont composées en tokens). La gestion réelle des
 * médias (upload banque) = future story admin, HORS SCOPE ici.
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
  /** Active locale for the overlay + slide copy. */
  locale?: Locale;
  /** Bank display name shown in the overlay header. */
  tenantName?: string;
  /** Current wall-clock time (kept out of the component for testability). */
  clock?: string;
  /** Whether the AdZone is on screen (drives/pauses the carousel). */
  active?: boolean;
  /** Reduced motion — disables the cross-fade transition. */
  reducedMotion?: boolean;
}

const rootStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: "100vh",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  backgroundColor: "var(--night-2, var(--surface-screen))",
  color: "var(--ink-inverse)",
  fontFamily: "var(--font-text)",
};

/**
 * Full-screen resting AdZone carousel.
 * @param props - {@link AdZoneProps}.
 * @returns The AdZone element.
 */
export function AdZone({
  slides = DEFAULT_AD_SLIDES,
  locale = "fr",
  tenantName = "",
  clock = "",
  active = true,
  reducedMotion = false,
}: AdZoneProps): ReactElement {
  const { index, current } = useAdCarousel({ slides, active });

  return (
    <div data-testid="tv-adzone" data-active={active ? "on" : "off"} style={rootStyle}>
      {/* Slides empilées ; opacité pilotée pour un fondu croisé doux */}
      <div data-testid="tv-adzone-stage" style={{ position: "absolute", inset: 0 }}>
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            data-testid="tv-adslide"
            data-slide-id={slide.id}
            data-visible={i === index ? "on" : "off"}
            aria-hidden={i === index ? undefined : true}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              justifyContent: "center",
              gap: "var(--space-6)",
              padding: "var(--space-24)",
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
            <div
              data-testid="tv-adslide-title"
              style={{
                position: "relative",
                fontSize: "var(--display-tv-hero)",
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                lineHeight: "var(--leading-tight)",
                letterSpacing: "var(--tracking-tight)",
                color: slide.accent ?? "var(--gold)",
                maxWidth: "16ch",
              }}
            >
              {t(slide.titleKey, locale)}
            </div>
            {slide.subtitleKey !== undefined && (
              <div
                data-testid="tv-adslide-subtitle"
                style={{
                  position: "relative",
                  fontSize: "var(--text-4xl)",
                  color: "var(--ink-inverse)",
                  maxWidth: "28ch",
                }}
              >
                {t(slide.subtitleKey, locale)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Overlay discret : nom banque + horloge en haut, ligne d'accueil en bas */}
      <header
        data-testid="tv-adzone-overlay"
        style={{
          position: "relative",
          height: "var(--tv-header-height)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-12)",
          color: "var(--ink-inverse-soft)",
          fontSize: "var(--text-lg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--brand)" }}>{tenantName}</span>
        <span
          data-testid="tv-adzone-clock"
          aria-hidden={clock === ""}
          style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "var(--tracking-numeric)" }}
        >
          {clock}
        </span>
      </header>

      <footer
        data-testid="tv-adzone-footer"
        style={{
          position: "relative",
          marginTop: "auto",
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
