/**
 * Tests for AdZone — rendering, slide rotation (fake-timers), overlay, tokens.
 * @module components/tv/ad-zone.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import { AdZone } from "./ad-zone";
import { DEFAULT_AD_SLIDES, AD_SLIDE_DURATION_MS, type AdSlide } from "@/lib/ad-slides";
import { SUPPORTED_LOCALES, t } from "@/lib/i18n";

function visibleSlideId(): string | null {
  const slides = screen.getAllByTestId("tv-adslide");
  const shown = slides.find((s) => s.getAttribute("data-visible") === "on");
  return shown?.getAttribute("data-slide-id") ?? null;
}

describe("AdZone — rendu", () => {
  it("AdZone: rend toutes les slides du deck de démo", () => {
    render(<AdZone />);
    expect(screen.getAllByTestId("tv-adslide")).toHaveLength(DEFAULT_AD_SLIDES.length);
  });

  it("AdZone: overlay banque — nom sur --brand + horloge", () => {
    render(<AdZone tenantName="Banque du Commerce" clock="14:37:22" />);
    const overlay = screen.getByTestId("tv-adzone-overlay");
    expect(within(overlay).getByText("Banque du Commerce")).toBeInTheDocument();
    const name = within(overlay).getByText("Banque du Commerce");
    expect(name.getAttribute("style")).toContain("var(--brand)");
    expect(screen.getByTestId("tv-adzone-clock")).toHaveTextContent("14:37:22");
  });

  it("AdZone: pied — accueil + « file d'attente en cours »", () => {
    render(<AdZone />);
    const footer = screen.getByTestId("tv-adzone-footer");
    expect(within(footer).getByText(t("tv.welcome", "fr"))).toBeInTheDocument();
    expect(within(footer).getByText(t("tv.queue_in_progress", "fr"))).toBeInTheDocument();
  });

  it("AdZone: fondu ~600ms — transition d'opacité en token --ease", () => {
    render(<AdZone />);
    const first = screen.getAllByTestId("tv-adslide")[0]!;
    expect(first.getAttribute("style")).toContain("var(--ease)");
    expect(first.getAttribute("style")).toContain("opacity 600ms");
  });

  it("AdZone: reduced-motion — pas de transition de fondu", () => {
    render(<AdZone reducedMotion />);
    const first = screen.getAllByTestId("tv-adslide")[0]!;
    expect(first.getAttribute("style")).toContain("transition: none");
  });

  it("AdZone: i18n — titres des slides rendus en FR/EN sans crash", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const { unmount } = render(<AdZone locale={locale} />);
      const title = t(DEFAULT_AD_SLIDES[0]!.titleKey, locale);
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("AdZone: slide banque avec imageUrl locale — rend un média (jamais réseau externe côté défaut)", () => {
    const slides: AdSlide[] = [
      { id: "media", titleKey: "tv.welcome", bg: "var(--night-2)", imageUrl: "/media/promo.jpg" },
    ];
    render(<AdZone slides={slides} />);
    expect(screen.getByTestId("tv-adslide-image")).toHaveAttribute("src", "/media/promo.jpg");
  });
});

describe("AdZone — rotation du carrousel (fake-timers)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("AdZone: fait défiler les slides après la durée par slide", () => {
    render(<AdZone />);
    expect(visibleSlideId()).toBe(DEFAULT_AD_SLIDES[0]!.id);
    act(() => vi.advanceTimersByTime(AD_SLIDE_DURATION_MS));
    expect(visibleSlideId()).toBe(DEFAULT_AD_SLIDES[1]!.id);
  });

  it("AdZone: inactive — reste figée sur la première slide", () => {
    render(<AdZone active={false} />);
    act(() => vi.advanceTimersByTime(AD_SLIDE_DURATION_MS * 3));
    expect(visibleSlideId()).toBe(DEFAULT_AD_SLIDES[0]!.id);
  });
});
