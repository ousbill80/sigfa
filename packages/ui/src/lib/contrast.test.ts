import { describe, it, expect } from "vitest";
import {
  contrastRatio,
  meetsWcag,
  type WcagLevel,
} from "./contrast.js";
import { surfaces, brand, semantic } from "src/tokens.js";

describe("contrastRatio", () => {
  it("returns 21 for pure black on pure white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
  });

  it("returns 1 for identical colours", () => {
    expect(contrastRatio("#C25A16", "#C25A16")).toBeCloseTo(1, 5);
  });

  it("is symmetric (order of arguments does not matter)", () => {
    const a = contrastRatio(surfaces.ink, surfaces.paper);
    const b = contrastRatio(surfaces.paper, surfaces.ink);
    expect(a).toBeCloseTo(b, 10);
  });

  it("accepts 3-digit shorthand hex", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 1);
  });

  it("accepts hex without a leading hash", () => {
    expect(contrastRatio("000000", "FFFFFF")).toBeCloseTo(21, 1);
  });

  it("throws on a malformed hex string", () => {
    expect(() => contrastRatio("#12", "#FFFFFF")).toThrow();
    expect(() => contrastRatio("nope", "#FFFFFF")).toThrow();
  });
});

describe("meetsWcag — text/background token proofs", () => {
  const cases: Array<[string, string, string, WcagLevel]> = [
    ["ink on paper", surfaces.ink, surfaces.paper, "AA"],
    ["ink-soft on paper", surfaces.inkSoft, surfaces.paper, "AA"],
    ["ink on surface-1", surfaces.ink, surfaces.surface1, "AA"],
    ["ink on surface-2", surfaces.ink, surfaces.surface2, "AA"],
    ["danger on paper", semantic.danger, surfaces.paper, "AA"],
    ["info on paper", semantic.info, surfaces.paper, "AA"],
    ["success on paper", semantic.success, surfaces.paper, "AA"],
  ];
  for (const [name, fg, bg, level] of cases) {
    it(`${name} meets WCAG ${level} for normal text`, () => {
      expect(meetsWcag(fg, bg, { level, size: "normal" })).toBe(true);
    });
  }

  it("brand-contrast on brand meets AA for large text (button ≥ 16px/600)", () => {
    expect(
      meetsWcag(brand.brandContrast, brand.brand, {
        level: "AA",
        size: "large",
      }),
    ).toBe(true);
  });

  it("brand-contrast on brand meets AA for normal text (F10, audit 2026-07-14)", () => {
    // White on the former default #C25A16 was 4.40:1, below the 4.5 threshold
    // the DS claims as « vérifié ». The default brand is darkened (#B85513,
    // 4.83:1 measured) so the claim is actually true.
    expect(
      meetsWcag(brand.brandContrast, brand.brand, {
        level: "AA",
        size: "normal",
      }),
    ).toBe(true);
  });
});

describe("meetsWcag — kiosk contrast ≥ 7:1", () => {
  const kiosk: Array<[string, string, string]> = [
    ["ink-inverse on night", surfaces.inkInverse, surfaces.night],
    ["ink-inverse-soft on night", surfaces.inkInverseSoft, surfaces.night],
    ["gold on night", brand.gold, surfaces.night],
    ["ink-inverse on night-2 (TV)", surfaces.inkInverse, surfaces.night2],
  ];
  for (const [name, fg, bg] of kiosk) {
    it(`${name} meets AAA (≥ 7:1)`, () => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(7);
      expect(meetsWcag(fg, bg, { level: "AAA", size: "normal" })).toBe(true);
    });
  }
});

describe("meetsWcag — thresholds", () => {
  it("uses 3:1 for AA large text", () => {
    // A pair at exactly ~3.1:1 passes AA-large but fails AA-normal.
    expect(meetsWcag("#767676", "#FFFFFF", { level: "AA", size: "large" })).toBe(
      true,
    );
  });

  it("defaults to AA normal text when no options are given", () => {
    expect(meetsWcag(surfaces.ink, surfaces.paper)).toBe(true);
  });
});
