import { describe, it, expect } from "vitest";
import { tokens, color, fontSize, radius, space, font } from "./tokens.js";
import { contrastRatio } from "./lib/contrast.js";

describe("design tokens", () => {
  it("every colour token is a valid hex string", () => {
    for (const [name, value] of Object.entries(color)) {
      expect(value, name).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("exposes the v3 « Neutre Premium » brand (deep-blue product fallback)", () => {
    expect(color["--brand"]).toBe("#1D4ED8");
    expect(color["--brand-inv"]).toBe("#8EA7EC");
    expect(color["--brand-contrast"]).toBe("#FFFFFF");
  });

  it("uses a pure neutral base — no warm/beige tint left", () => {
    expect(color["--paper"]).toBe("#FAFAFA");
    expect(color["--ink"]).toBe("#0A0A0A");
    // Neutres purs : canaux R = G = B sur toute la rampe surfaces/encre.
    for (const token of [
      "--paper",
      "--surface-1",
      "--surface-2",
      "--ink",
      "--ink-soft",
      "--ink-faint",
      "--hairline",
      "--night",
      "--night-2",
      "--ink-inverse",
      "--ink-inverse-soft",
    ] as const) {
      const hex = color[token];
      expect(hex.slice(1, 3), token).toBe(hex.slice(3, 5));
      expect(hex.slice(3, 5), token).toBe(hex.slice(5, 7));
    }
  });

  it("keeps the deprecated v2 aliases mapped onto v3 equivalents (migration)", () => {
    // DEPRECATED v3 — à supprimer après migration des surfaces.
    expect(color["--forest"]).toBe(color["--success"]);
    expect(color["--forest-soft"]).toBe(color["--success-soft"]);
    expect(color["--gold"]).toBe(color["--brand-inv"]);
    expect(color["--gold-soft"]).toBe(color["--brand-soft"]);
  });

  it("carries the kiosk display size (76px ticket number)", () => {
    expect(fontSize.display).toBe(76);
    expect(fontSize["4xl"]).toBe(49);
  });

  it("has a coherent, assumed radius scale", () => {
    expect(radius.md).toBe(12);
    expect(radius.lg).toBe(18);
    expect(radius.xl).toBe(28);
  });

  it("uses a base-4 spacing scale", () => {
    for (const value of Object.values(space)) {
      expect(value % 4).toBe(0);
    }
  });

  it("makes fonts swappable via a stack (display first, system fallback)", () => {
    expect(font.display).toContain("Clash Display");
    expect(font.display).toContain("ui-sans-serif");
    expect(font.text).toContain("General Sans");
  });

  it("carries a mono stack (audit codes / identifiers)", () => {
    expect(font.mono).toContain("ui-monospace");
    expect(font.mono).toContain("monospace");
  });

  it("bundles all groups for a mobile RN theme", () => {
    expect(tokens.color).toBe(color);
    expect(tokens.fontSize).toBe(fontSize);
    expect(tokens.radius).toBe(radius);
    expect(tokens.space).toBe(space);
    expect(tokens.font).toBe(font);
    expect(tokens.motion.ease).toContain("cubic-bezier");
  });
});

/**
 * Preuves de contraste WCAG sur les paires de tokens (v3 « Neutre Premium »).
 * Seuils DS : ≥ 7:1 sur fonds sombres kiosque/TV, ≥ 4.5:1 minimum absolu
 * (texte normal, web). Ces tests verrouillent les valeurs : tout
 * assombrissement/éclaircissement d'un token qui casse un seuil échoue ici.
 */
describe("token contrast proofs (WCAG)", () => {
  it("--brand-contrast on --brand ≥ 4.5:1 (normal text, claimed by the DS)", () => {
    expect(
      contrastRatio(color["--brand-contrast"], color["--brand"]),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("--brand-strong (kiosk --action-label) ≥ 7:1 on --surface-1", () => {
    expect(
      contrastRatio(color["--brand-strong"], color["--surface-1"]),
    ).toBeGreaterThanOrEqual(7);
  });

  it("--brand ≥ 4.5:1 as text on --paper and --surface-1 (links, accents)", () => {
    expect(
      contrastRatio(color["--brand"], color["--paper"]),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(color["--brand"], color["--surface-1"]),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("--brand-inv (ticket number) ≥ 7:1 on --night AND --night-2", () => {
    expect(
      contrastRatio(color["--brand-inv"], color["--night"]),
    ).toBeGreaterThanOrEqual(7);
    expect(
      contrastRatio(color["--brand-inv"], color["--night-2"]),
    ).toBeGreaterThanOrEqual(7);
  });

  it("semantic tokens ≥ 4.5:1 as text on --paper and --surface-1 (web)", () => {
    for (const token of [
      "--success",
      "--warning",
      "--danger",
      "--info",
    ] as const) {
      expect(
        contrastRatio(color[token], color["--paper"]),
        `${token} on --paper`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(color[token], color["--surface-1"]),
        `${token} on --surface-1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("semantic tokens ≥ 4.5:1 as text on their own -soft fill (badges)", () => {
    for (const [fg, bg] of [
      ["--success", "--success-soft"],
      ["--warning", "--warning-soft"],
      ["--danger", "--danger-soft"],
      ["--info", "--info-soft"],
      ["--brand", "--brand-soft"],
    ] as const) {
      expect(
        contrastRatio(color[fg], color[bg]),
        `${fg} on ${bg}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("-soft fills stay light enough to carry --ink (≥ 4.5:1)", () => {
    for (const token of [
      "--success-soft",
      "--warning-soft",
      "--danger-soft",
      "--info-soft",
      "--brand-soft",
    ] as const) {
      expect(
        contrastRatio(color["--ink"], color[token]),
        `--ink on ${token}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("inverse semantic tokens ≥ 7:1 on --night AND --night-2", () => {
    for (const token of [
      "--success-inv",
      "--warning-inv",
      "--danger-inv",
      "--info-inv",
    ] as const) {
      expect(
        contrastRatio(color[token], color["--night"]),
        `${token} on --night`,
      ).toBeGreaterThanOrEqual(7);
      expect(
        contrastRatio(color[token], color["--night-2"]),
        `${token} on --night-2`,
      ).toBeGreaterThanOrEqual(7);
    }
  });

  it("inverse ink ramp ≥ 7:1 on --night AND --night-2 (EmptyState, TV)", () => {
    for (const surface of ["--night", "--night-2"] as const) {
      expect(
        contrastRatio(color["--ink-inverse"], color[surface]),
        `--ink-inverse on ${surface}`,
      ).toBeGreaterThanOrEqual(7);
      expect(
        contrastRatio(color["--ink-inverse-soft"], color[surface]),
        `--ink-inverse-soft on ${surface}`,
      ).toBeGreaterThanOrEqual(7);
    }
  });

  it("--ink-soft ≥ 4.5:1 on every light surface (secondary text)", () => {
    for (const surface of ["--paper", "--surface-1", "--surface-2"] as const) {
      expect(
        contrastRatio(color["--ink-soft"], color[surface]),
        `--ink-soft on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("deprecated --gold alias (ticket number) stays ≥ 7:1 on --night", () => {
    // DEPRECATED v3 — filet de sécurité tant que les surfaces TV/kiosk
    // référencent encore var(--gold) : l'alias pointe sur --brand-inv.
    expect(
      contrastRatio(color["--gold"], color["--night"]),
    ).toBeGreaterThanOrEqual(7);
  });
});
