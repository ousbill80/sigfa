import { describe, it, expect } from "vitest";
import {
  resolvePdfTheme,
  onColorFor,
  meetsContrastAA,
  DEFAULT_BRAND_COLOR,
  DEFAULT_TEXT_COLOR,
} from "src/reporting/pdf/theme.js";

describe("REP-002b: theme tenant PDF", () => {
  it("REP-002b: applique les défauts SIGFA quand le tenant ne fournit rien", () => {
    const theme = resolvePdfTheme();
    expect(theme.brand).toBe(DEFAULT_BRAND_COLOR);
    expect(theme.bankName).toBe("SIGFA");
    expect(theme.logoSrc).toBeNull();
  });

  it("REP-002b: applique la couleur/logo/nom du tenant (branding sans effort)", () => {
    const theme = resolvePdfTheme({
      brandColor: "#0F766E",
      bankName: "Banque Atlantique",
      logoSrc: "data:image/png;base64,AAAA",
    });
    expect(theme.brand).toBe("#0f766e");
    expect(theme.bankName).toBe("Banque Atlantique");
    expect(theme.logoSrc).toBe("data:image/png;base64,AAAA");
  });

  it("REP-002b: rejette une couleur invalide et retombe sur le défaut", () => {
    expect(resolvePdfTheme({ brandColor: "teal" }).brand).toBe(DEFAULT_BRAND_COLOR);
    expect(resolvePdfTheme({ brandColor: "#12" }).brand).toBe(DEFAULT_BRAND_COLOR);
  });

  it("REP-002b: nom/logo vides ou blancs retombent sur les défauts", () => {
    const theme = resolvePdfTheme({ bankName: "   ", logoSrc: "  " });
    expect(theme.bankName).toBe("SIGFA");
    expect(theme.logoSrc).toBeNull();
  });

  it("REP-002b: texte du bandeau (onBrand) contraste >= AA sur la marque — 2 tenants", () => {
    for (const brandColor of ["#0F766E", "#facc15"]) {
      const theme = resolvePdfTheme({ brandColor });
      expect(meetsContrastAA(theme.onBrand, theme.brand)).toBe(true);
    }
  });

  it("REP-002b: texte principal contraste >= AA sur le fond de page", () => {
    const theme = resolvePdfTheme();
    expect(meetsContrastAA(theme.text, theme.pageBackground)).toBe(true);
    expect(meetsContrastAA(theme.muted, theme.pageBackground)).toBe(true);
  });

  it("REP-002b: onColorFor choisit blanc sur fond sombre, noir sur fond clair", () => {
    expect(onColorFor("#111111")).toBe("#ffffff");
    expect(onColorFor("#fefefe")).toBe(DEFAULT_TEXT_COLOR);
  });
});
