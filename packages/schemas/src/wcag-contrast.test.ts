/**
 * Tests unitaires — correction de contraste WCAG (API-009).
 *
 * Vérifie la luminance relative, le ratio de contraste et surtout la CORRECTION :
 * toute couleur faiblement contrastée doit être ajustée à ≥ 4.5:1 MESURÉ, sur
 * cas limites (fond clair, fond sombre, couleur déjà conforme, fond médian).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  rgbToHex,
  relativeLuminance,
  contrastRatio,
  correctContrast,
  MIN_CONTRAST_RATIO,
} from "./wcag-contrast.js";

describe("API-009: WCAG contrast — primitives", () => {
  it("hexToRgb parse #RRGGBB (casse indifférente)", () => {
    expect(hexToRgb("#FF8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 255, b: 0 });
  });

  it("rgbToHex reconstruit un hex minuscule à 6 chiffres", () => {
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe("#ff8000");
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
  });

  it("luminance relative : noir = 0, blanc = 1", () => {
    expect(relativeLuminance(hexToRgb("#000000"))).toBeCloseTo(0, 5);
    expect(relativeLuminance(hexToRgb("#ffffff"))).toBeCloseTo(1, 5);
  });

  it("ratio noir/blanc = 21:1 (maximum WCAG)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("ratio est symétrique", () => {
    expect(contrastRatio("#003f7f", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#003f7f"),
      5
    );
  });
});

describe("API-009: WCAG contrast — correction ≥4.5:1 mesuré", () => {
  it("couleur déjà conforme reste inchangée (bleu foncé sur blanc)", () => {
    const bg = "#ffffff";
    const fg = "#003f7f";
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    expect(correctContrast(fg, bg)).toBe(fg.toLowerCase());
  });

  it("jaune faible contraste sur blanc → corrigé et MESURÉ ≥4.5:1", () => {
    const bg = "#ffffff";
    const fg = "#e8a000";
    expect(contrastRatio(fg, bg)).toBeLessThan(MIN_CONTRAST_RATIO);
    const applied = correctContrast(fg, bg);
    expect(applied).not.toBe(fg.toLowerCase());
    expect(contrastRatio(applied, bg)).toBeGreaterThanOrEqual(
      MIN_CONTRAST_RATIO
    );
  });

  it("couleur claire sur fond sombre → éclaircie et ≥4.5:1", () => {
    const bg = "#000000";
    const fg = "#333333";
    expect(contrastRatio(fg, bg)).toBeLessThan(MIN_CONTRAST_RATIO);
    const applied = correctContrast(fg, bg);
    expect(contrastRatio(applied, bg)).toBeGreaterThanOrEqual(
      MIN_CONTRAST_RATIO
    );
  });

  it("cas limite : fond médian gris → correction atteint quand même ≥4.5:1", () => {
    const bg = "#777777";
    for (const fg of ["#808080", "#888888", "#707070"]) {
      const applied = correctContrast(fg, bg);
      expect(contrastRatio(applied, bg)).toBeGreaterThanOrEqual(
        MIN_CONTRAST_RATIO
      );
    }
  });

  it("cas limite : couleur identique au fond → corrigée vers l'extrême conforme", () => {
    const applied = correctContrast("#ffffff", "#ffffff");
    expect(contrastRatio(applied, "#ffffff")).toBeGreaterThanOrEqual(
      MIN_CONTRAST_RATIO
    );
  });
});
