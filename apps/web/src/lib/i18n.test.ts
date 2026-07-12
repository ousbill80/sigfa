/**
 * Tests for i18n utilities — WEB-001
 * @module lib/i18n.test
 */
import { describe, it, expect } from "vitest";
import { t, SUPPORTED_LOCALES, FR, LOCALES } from "./i18n";

describe("WEB-001: i18n — labels de navigation en FR (base), FR/EN uniquement", () => {
  it("returns French nav labels by default", () => {
    expect(t("nav.dashboard")).toBe("Tableau de bord");
    expect(t("nav.admin")).toBe("Administration");
    expect(t("nav.agent")).toBe("Guichet");
    expect(t("nav.audit")).toBe("Audit");
    expect(t("nav.logout")).toBe("Déconnexion");
  });

  it("returns English labels when locale is 'en'", () => {
    expect(t("nav.dashboard", "en")).toBe("Dashboard");
    expect(t("nav.logout", "en")).toBe("Logout");
    expect(t("auth.login", "en")).toBe("Login");
  });

  it("supports exactly 2 locales (FR/EN)", () => {
    expect(SUPPORTED_LOCALES).toHaveLength(2);
    expect(SUPPORTED_LOCALES).toContain("fr");
    expect(SUPPORTED_LOCALES).toContain("en");
  });

  it("all locales have same keys as FR (base)", () => {
    const frKeys = Object.keys(FR);
    for (const locale of SUPPORTED_LOCALES) {
      const dict = LOCALES[locale];
      for (const key of frKeys) {
        expect(dict).toHaveProperty(key);
      }
    }
  });

  it("returns error labels in French", () => {
    expect(t("error.service_unavailable")).toBe("Service indisponible");
    expect(t("error.403")).toBe("Accès refusé");
    expect(t("offline.banner")).toBe("Mode hors ligne — données depuis le cache");
  });
});
