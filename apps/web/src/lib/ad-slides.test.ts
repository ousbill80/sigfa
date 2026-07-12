/**
 * Tests for the ad-slides model — default demo slides shape, tokens-only.
 * @module lib/ad-slides.test
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_AD_SLIDES,
  AD_SLIDE_DURATION_MS,
  AD_FADE_MS,
  type AdSlide,
} from "./ad-slides";

describe("ad-slides — default demo deck", () => {
  it("AdZone: fournit ≥2 slides de démonstration premium avec identité stable", () => {
    expect(DEFAULT_AD_SLIDES.length).toBeGreaterThanOrEqual(2);
    const ids = DEFAULT_AD_SLIDES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("AdZone: chaque slide a un titre i18n et un fond en tokens uniquement", () => {
    for (const slide of DEFAULT_AD_SLIDES) {
      expect(slide.titleKey).toMatch(/^tv\.ad\./);
      // Fonds composés uniquement en var(--token) — aucun hex.
      expect(slide.bg).toContain("var(--");
      expect(slide.bg).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      if (slide.accent !== undefined) {
        expect(slide.accent).toContain("var(--");
      }
    }
  });

  it("AdZone: défaut de démo — aucune image réseau externe (pas d'imageUrl)", () => {
    for (const slide of DEFAULT_AD_SLIDES) {
      expect(slide.imageUrl).toBeUndefined();
    }
  });

  it("AdZone: durées de démo cohérentes (slide 8s, fondu 600ms)", () => {
    expect(AD_SLIDE_DURATION_MS).toBe(8000);
    expect(AD_FADE_MS).toBe(600);
  });

  it("AdZone: le type AdSlide accepte une liste banque personnalisée", () => {
    const custom: AdSlide[] = [
      { id: "x", titleKey: "tv.welcome", bg: "var(--night-2)" },
    ];
    expect(custom[0]!.id).toBe("x");
  });
});
