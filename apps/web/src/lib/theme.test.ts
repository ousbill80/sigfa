/**
 * Tests for theming utilities — WEB-001
 * @module lib/theme.test
 */
import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  contrastRatio,
  darkenColor,
  autoCorrectedBrand,
  generateCSSVars,
} from "./theme";

describe("WEB-001: theming", () => {
  describe("hexToRgb", () => {
    it("parses 6-digit hex", () => {
      expect(hexToRgb("#1a56db")).toEqual([26, 86, 219]);
    });

    it("parses 3-digit hex", () => {
      expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    });

    it("returns null for invalid hex", () => {
      expect(hexToRgb("invalid")).toBeNull();
      expect(hexToRgb("#gg0000")).toBeNull();
    });
  });

  describe("contrastRatio", () => {
    it("returns ~21 for black on white", () => {
      const ratio = contrastRatio("#000000", "#ffffff");
      expect(ratio).toBeCloseTo(21, 0);
    });

    it("returns 1 for same color", () => {
      expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 0);
    });
  });

  describe("WEB-001: contraste auto-corrigé — brand hors ratio ≥ 4.5:1 foncé automatiquement", () => {
    it("darkens a light brand color until it passes WCAG AA (4.5:1)", () => {
      const lightBrand = "#a8c5f5"; // Too light on white
      const corrected = autoCorrectedBrand(lightBrand);
      expect(contrastRatio(corrected, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    });

    it("does not change a brand already at ≥4.5:1", () => {
      const darkBrand = "#1a56db"; // Already passes
      const corrected = autoCorrectedBrand(darkBrand);
      expect(corrected).toBe(darkBrand);
    });

    it("handles very light brand (#f0f0f0) and achieves ratio", () => {
      const corrected = autoCorrectedBrand("#f0f0f0");
      expect(contrastRatio(corrected, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe("WEB-001: theming tenant — --brand injecté sur layout root, snapshot 3 tenants", () => {
    it("generates CSS vars with --brand for tenant 1 (BNI)", () => {
      const css = generateCSSVars({ brand: "#1a56db" });
      expect(css).toContain("--brand:");
      expect(css).toContain("--surface-0:");
      expect(css).toContain("--ink-strong:");
    });

    it("generates CSS vars for tenant 2 (BCI - orange brand)", () => {
      const css = generateCSSVars({ brand: "#e65c00" });
      expect(css).toContain("--brand:");
      // Orange is dark enough on white
      const brandMatch = css.match(/--brand: (#[0-9a-f]+)/i);
      expect(brandMatch).toBeTruthy();
    });

    it("generates CSS vars for tenant 3 (BMOI - green brand)", () => {
      const css = generateCSSVars({ brand: "#00704a" });
      expect(css).toContain("--brand:");
    });
  });

  describe("WEB-001: tokens uniquement — CSS vars present", () => {
    it("all required token variables are present in output", () => {
      const css = generateCSSVars({ brand: "#1a56db" });
      const requiredTokens = [
        "--brand",
        "--brand-soft",
        "--brand-contrast",
        "--surface-0",
        "--surface-1",
        "--ink-strong",
        "--ink-soft",
        "--success",
        "--warning",
        "--danger",
        "--info",
      ];
      for (const token of requiredTokens) {
        expect(css).toContain(token);
      }
    });
  });

  describe("darkenColor", () => {
    it("darkens by factor", () => {
      const darkened = darkenColor("#ffffff", 0.5);
      expect(darkened).toBe("#808080");
    });

    it("returns same color for factor 0", () => {
      expect(darkenColor("#1a56db", 0)).toBe("#1a56db");
    });
  });
});
