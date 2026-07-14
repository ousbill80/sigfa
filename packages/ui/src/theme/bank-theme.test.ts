import { describe, it, expect } from "vitest";
import { deriveBankTheme, SIGFA_DEFAULT_BRAND } from "./bank-theme.js";
import { contrastRatio, meetsWcag } from "src/lib/contrast.js";

/**
 * Bank palettes used across the proof suite AND the gallery demo. Deliberately
 * spread across the hue wheel + lightness range: a mid blue, a dark green, a
 * vivid violet, plus edge cases (near-black, near-white, saturated red).
 */
const BANKS: ReadonlyArray<[string, string]> = [
  ["blue bank", "#1E5AA8"],
  ["green bank", "#0B7A4B"],
  ["violet bank", "#6B3FA0"],
];

const EDGE_CASES: ReadonlyArray<[string, string]> = [
  ["near-black", "#101010"],
  ["near-white", "#F4F4F4"],
  ["vivid red", "#E01E1E"],
  ["vivid yellow", "#F2D024"],
  ["sigfa terracotta", "#C25A16"],
];

const HEX6 = /^#[0-9a-f]{6}$/;

describe("deriveBankTheme — shape & format", () => {
  it("returns four normalised 6-digit lowercase hex tokens", () => {
    const theme = deriveBankTheme("#1E5AA8");
    expect(theme.brand).toMatch(HEX6);
    expect(theme.brandStrong).toMatch(HEX6);
    expect(theme.brandSoft).toMatch(HEX6);
    expect(theme.brandContrast).toMatch(HEX6);
  });

  it("normalises the input brand to lowercase 6-digit hex", () => {
    expect(deriveBankTheme("#1e5aa8").brand).toBe("#1e5aa8");
    expect(deriveBankTheme("1E5AA8").brand).toBe("#1e5aa8");
  });

  it("expands 3-digit shorthand", () => {
    expect(deriveBankTheme("#08f").brand).toBe("#0088ff");
  });

  it("is pure — same input yields identical output", () => {
    expect(deriveBankTheme("#6B3FA0")).toEqual(deriveBankTheme("#6B3FA0"));
  });

  it("throws on a malformed hex input", () => {
    expect(() => deriveBankTheme("nope")).toThrow();
    expect(() => deriveBankTheme("#12")).toThrow();
  });

  it("exports the SIGFA default brand (terracotta, ≥ 4.5:1 under white)", () => {
    expect(SIGFA_DEFAULT_BRAND).toBe("#b85513");
    // F10 (audit borne 2026-07-14) : le DS revendique ≥ 4.5:1 « vérifié » pour
    // --brand-contrast (blanc) sur --brand — la valeur par défaut doit le tenir.
    expect(contrastRatio("#ffffff", SIGFA_DEFAULT_BRAND)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("deriveBankTheme — brandStrong is darker, same hue", () => {
  for (const [name, hex] of [...BANKS, ...EDGE_CASES]) {
    it(`${name}: brandStrong is darker than (or equal to) brand`, () => {
      const { brand, brandStrong } = deriveBankTheme(hex);
      // A darker colour has lower relative luminance -> higher contrast on white.
      expect(contrastRatio(brandStrong, "#ffffff")).toBeGreaterThanOrEqual(
        contrastRatio(brand, "#ffffff") - 1e-9,
      );
    });
  }
});

describe("deriveBankTheme — brandStrong holds the kiosk action-label threshold", () => {
  // F10 (audit borne 2026-07-14) : le kiosque affiche les libellés d'action en
  // --brand-strong sur carte claire (--surface-1). Seuil DS kiosque : ≥ 7:1.
  // La dérivation doit le garantir pour TOUT brand tenant, pas juste le défaut.
  for (const [name, hex] of [...BANKS, ...EDGE_CASES]) {
    it(`${name}: brandStrong ≥ 7:1 on --surface-1 (white)`, () => {
      const { brandStrong } = deriveBankTheme(hex);
      expect(contrastRatio(brandStrong, "#ffffff")).toBeGreaterThanOrEqual(7);
    });
  }
});

describe("deriveBankTheme — brandSoft is a very light tint", () => {
  for (const [name, hex] of [...BANKS, ...EDGE_CASES]) {
    it(`${name}: brandSoft is light enough to carry dark text`, () => {
      const { brandSoft } = deriveBankTheme(hex);
      // Soft tints back badges/highlights -> must read with --ink (#1A130C).
      expect(meetsWcag("#1a130c", brandSoft, { level: "AA", size: "normal" })).toBe(
        true,
      );
    });
  }
});

describe("deriveBankTheme — brandContrast meets WCAG AA ≥ 4.5:1 on brand", () => {
  for (const [name, hex] of [...BANKS, ...EDGE_CASES]) {
    it(`${name}: brandContrast on brand ≥ 4.5:1 (normal text)`, () => {
      const { brand, brandContrast } = deriveBankTheme(hex);
      const ratio = contrastRatio(brandContrast, brand);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(
        meetsWcag(brandContrast, brand, { level: "AA", size: "normal" }),
      ).toBe(true);
    });
  }

  it("picks black contrast on a light brand, white on a dark brand", () => {
    expect(deriveBankTheme("#F2D024").brandContrast).toBe("#000000");
    expect(deriveBankTheme("#1E5AA8").brandContrast).toBe("#ffffff");
  });
});
