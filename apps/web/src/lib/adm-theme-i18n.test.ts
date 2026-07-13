/**
 * Tests for the dedicated `admTheme.*` i18n namespace (ADM-001b).
 * Verifies FR/EN parity, fallback to FR, and namespace isolation.
 * @module lib/adm-theme-i18n.test
 */
import { describe, it, expect } from "vitest";
import { ADM_THEME_FR, ADM_THEME_EN, tAdmTheme, type AdmThemeKey } from "./adm-theme-i18n";

describe("adm-theme-i18n — namespace admTheme.*", () => {
  it("ADM-001b: FR et EN couvrent exactement les mêmes clés", () => {
    expect(Object.keys(ADM_THEME_EN).sort()).toEqual(Object.keys(ADM_THEME_FR).sort());
  });

  it("ADM-001b: toutes les clés sont préfixées admTheme. (isolation namespace)", () => {
    for (const key of Object.keys(ADM_THEME_FR)) {
      expect(key.startsWith("admTheme.")).toBe(true);
    }
  });

  it("ADM-001b: aucune valeur vide, ni FR ni EN", () => {
    for (const key of Object.keys(ADM_THEME_FR) as AdmThemeKey[]) {
      expect(ADM_THEME_FR[key].length).toBeGreaterThan(0);
      expect(ADM_THEME_EN[key].length).toBeGreaterThan(0);
    }
  });

  it("ADM-001b: tAdmTheme renvoie FR par défaut et EN quand demandé", () => {
    expect(tAdmTheme("admTheme.save")).toBe(ADM_THEME_FR["admTheme.save"]);
    expect(tAdmTheme("admTheme.save", "en")).toBe(ADM_THEME_EN["admTheme.save"]);
  });

  it("ADM-001b: la mention « habillage jamais structure » est présente FR/EN", () => {
    expect(tAdmTheme("admTheme.habillage_notice", "fr")).toMatch(/habillage/i);
    expect(tAdmTheme("admTheme.habillage_notice", "en")).toMatch(/skin|structure/i);
  });
});
