import { describe, it, expect } from "vitest";
import { tokens, color, fontSize, radius, space, font } from "./tokens.js";
import { contrastRatio } from "./lib/contrast.js";

describe("design tokens", () => {
  it("every colour token is a valid hex string", () => {
    for (const [name, value] of Object.entries(color)) {
      expect(value, name).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("exposes the « Or & Forêt » brand trio", () => {
    expect(color["--brand"]).toBe("#B85513");
    expect(color["--forest"]).toBe("#0F6B4A");
    expect(color["--gold"]).toBe("#C79A3A");
  });

  it("uses a warm paper base, never clinical grey", () => {
    expect(color["--paper"]).toBe("#FBF8F3");
    expect(color["--ink"]).toBe("#1A130C");
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
 * Preuves de contraste WCAG sur les paires de tokens (audit UX borne
 * 2026-07-14, findings F6/F10). Seuils DS kiosque : ≥ 7:1 sur fond nuit,
 * ≥ 4.5:1 minimum absolu (texte normal). Ces tests verrouillent les valeurs :
 * tout assombrissement/éclaircissement d'un token qui casse un seuil échoue ici.
 */
describe("token contrast proofs (WCAG)", () => {
  it("F10: --brand-contrast on --brand ≥ 4.5:1 (normal text, claimed by the DS)", () => {
    expect(
      contrastRatio(color["--brand-contrast"], color["--brand"]),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("F10: --brand-strong (kiosk --action-label) ≥ 7:1 on --surface-1", () => {
    expect(
      contrastRatio(color["--brand-strong"], color["--surface-1"]),
    ).toBeGreaterThanOrEqual(7);
  });

  it("F6: inverse semantic tokens ≥ 7:1 on --night AND --night-2", () => {
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

  it("F1: inverse ink ramp ≥ 7:1 on --night (EmptyState on-night variant)", () => {
    expect(
      contrastRatio(color["--ink-inverse"], color["--night"]),
    ).toBeGreaterThanOrEqual(7);
    expect(
      contrastRatio(color["--ink-inverse-soft"], color["--night"]),
    ).toBeGreaterThanOrEqual(7);
  });

  it("gold ticket number stays ≥ 7:1 on --night (Moment Ticket)", () => {
    expect(
      contrastRatio(color["--gold"], color["--night"]),
    ).toBeGreaterThanOrEqual(7);
  });
});
