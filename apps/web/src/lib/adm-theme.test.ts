/**
 * Tests for the theming console preview logic (ADM-001b).
 *
 * Proves the preview MIRRORS the server: derivation + contrast come from the
 * shared @sigfa/ui utilities, the applied colour is darkened until AA holds
 * exactly like ADM-001a, and theme error codes translate to human namespaced
 * messages (raw code never surfaced).
 * @module lib/adm-theme.test
 */
import { describe, it, expect } from "vitest";
import { contrastRatio, deriveBankTheme } from "@sigfa/ui";
import {
  previewBrand,
  toRequestedColors,
  translateThemeError,
  canConfigureTheming,
  MIN_CONTRAST,
  SURFACE,
  BRAND_HEX_RE,
} from "./adm-theme";
import { ADM_THEME_FR } from "./adm-theme-i18n";
import type { Role } from "./roles";

describe("previewBrand — miroir exact du calcul serveur (ADM-001b)", () => {
  it("ADM-001b: couleur non hex → invalide, aucun token dérivé", () => {
    const p = previewBrand("not-a-color");
    expect(p.valid).toBe(false);
    expect(p.tokens).toBeNull();
    expect(p.passes).toBe(false);
  });

  it("ADM-001b: brand valide passant AA → tokens dérivés, aucune correction", () => {
    const p = previewBrand("#003f7f");
    expect(p.valid).toBe(true);
    expect(p.tokens).not.toBeNull();
    // Les tokens sont EXACTEMENT ceux du dérivateur partagé @sigfa/ui.
    expect(p.tokens).toEqual(deriveBankTheme("#003f7f"));
    expect(p.passes).toBe(true);
    expect(p.corrected).toBe(false);
    expect(p.appliedBrand).toBe(deriveBankTheme("#003f7f").brand);
  });

  it("ADM-001b: le ratio affiché provient de l'utilitaire partagé contrastRatio (brand sur surface)", () => {
    const p = previewBrand("#003f7f");
    expect(p.ratio).toBe(contrastRatio(deriveBankTheme("#003f7f").brand, SURFACE));
  });

  it("ADM-001b: les tokens dérivés proviennent du dérivateur partagé @sigfa/ui", () => {
    const p = previewBrand("#003f7f");
    expect(p.tokens).toEqual(deriveBankTheme("#003f7f"));
  });

  it("ADM-001b: brand clair échouant AA sur surface → assombri, corrected:true, valeur appliquée conforme", () => {
    const p = previewBrand("#ffe000"); // jaune clair : illisible sur blanc.
    expect(p.valid).toBe(true);
    expect(p.passes).toBe(false);
    expect(p.corrected).toBe(true);
    expect(p.appliedBrand).not.toBe(deriveBankTheme("#ffe000").brand);
    expect(contrastRatio(p.appliedBrand, SURFACE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    // Les tokens reflètent la couleur CORRIGÉE (miroir serveur).
    expect(p.tokens).toEqual(deriveBankTheme(p.appliedBrand));
  });

  it("ADM-001b: sur 20 couleurs échantillon, la valeur appliquée clear TOUJOURS 4.5:1 sur surface", () => {
    const samples = [
      "#003f7f", "#e8a000", "#ffffff", "#000000", "#ff0000", "#00ff00", "#0000ff",
      "#ffe000", "#c25a16", "#9c400c", "#f7e7d6", "#123456", "#abcdef", "#fedcba",
      "#808080", "#ff69b4", "#2e8b57", "#4682b4", "#deb887", "#7fffd4",
    ];
    for (const s of samples) {
      const p = previewBrand(s);
      expect(p.valid).toBe(true);
      expect(contrastRatio(p.appliedBrand, SURFACE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("ADM-001b: BRAND_HEX_RE = le pattern du contrat ColorSet (#RRGGBB)", () => {
    expect(BRAND_HEX_RE.test("#003f7f")).toBe(true);
    expect(BRAND_HEX_RE.test("#FFF")).toBe(false);
    expect(BRAND_HEX_RE.test("003f7f")).toBe(false);
  });
});

describe("toRequestedColors — payload on-contract (ADM-001b)", () => {
  it("ADM-001b: mappe le brand unique sur ColorSet {primary,secondary,background}", () => {
    const cs = toRequestedColors("#003f7f");
    const tokens = deriveBankTheme("#003f7f");
    expect(cs.primary).toBe(tokens.brand);
    expect(cs.secondary).toBe(tokens.brandStrong);
    expect(cs.background).toBe("#ffffff");
  });

  it("ADM-001b: primary/secondary/background respectent le pattern #RRGGBB", () => {
    const cs = toRequestedColors("#e8a000");
    expect(BRAND_HEX_RE.test(cs.primary)).toBe(true);
    expect(BRAND_HEX_RE.test(cs.secondary)).toBe(true);
    expect(BRAND_HEX_RE.test(cs.background)).toBe(true);
  });
});

describe("canConfigureTheming — RBAC theming (ADM-001b)", () => {
  it("ADM-001b: SUPER_ADMIN / BANK_ADMIN / AGENCY_DIRECTOR autorisés", () => {
    (["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR"] as Role[]).forEach((r) => {
      expect(canConfigureTheming(r)).toBe(true);
    });
  });

  it("ADM-001b: MANAGER / AGENT / AUDITOR refusés", () => {
    (["MANAGER", "AGENT", "AUDITOR"] as Role[]).forEach((r) => {
      expect(canConfigureTheming(r)).toBe(false);
    });
  });
});

describe("translateThemeError — messages humains namespacés (ADM-001b)", () => {
  it("ADM-001b: INVALID_BRAND → message admTheme dédié (jamais le code brut)", () => {
    const msg = translateThemeError({ error: { code: "INVALID_BRAND" } });
    expect(msg).toBe(ADM_THEME_FR["admTheme.error_invalid_brand"]);
    expect(msg).not.toMatch(/INVALID_BRAND/);
  });

  it("ADM-001b: UNKNOWN_FIELD → message admTheme dédié", () => {
    expect(translateThemeError({ error: { code: "UNKNOWN_FIELD" } })).toBe(
      ADM_THEME_FR["admTheme.error_unknown_field"],
    );
  });

  it("ADM-001b: INVALID_LOGO et UNSUPPORTED_MEDIA_TYPE → message logo", () => {
    expect(translateThemeError({ error: { code: "INVALID_LOGO" } })).toBe(
      ADM_THEME_FR["admTheme.error_invalid_logo"],
    );
    expect(translateThemeError({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } })).toBe(
      ADM_THEME_FR["admTheme.error_invalid_logo"],
    );
  });

  it("ADM-001b: code inconnu ou absent → message générique", () => {
    expect(translateThemeError({ error: { code: "WHATEVER" } })).toBe(ADM_THEME_FR["admTheme.error_generic"]);
    expect(translateThemeError(null)).toBe(ADM_THEME_FR["admTheme.error_generic"]);
  });

  it("ADM-001b: traduit en anglais quand la locale est en", () => {
    const msg = translateThemeError({ error: { code: "INVALID_BRAND" } }, "en");
    expect(msg).toMatch(/Invalid colour/);
  });
});
