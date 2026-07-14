/**
 * Audit UX borne 2026-07-14 — F1 / F6 / F10 : verrou de contraste WCAG sur
 * les paires de tokens réellement utilisées par le kiosque.
 *
 * Réutilise l'utilitaire de contraste de `@sigfa/ui` (lib/contrast) et le
 * miroir JS des tokens (`tokens.ts`, identique à `tokens.css`). Seuils DS
 * kiosque (CLAUDE.md §8, SIGFA_DESIGN_SYSTEM_v2 §2) :
 *   - ≥ 7:1 pour tout texte porteur de sens sur fond nuit (--night/--night-2)
 *     et sur carte claire (--surface-1) — borne plein soleil ;
 *   - ≥ 4.5:1 minimum absolu (texte normal) pour --brand-contrast sur --brand.
 *
 * Si un token bouge (theming, refonte), ces tests échouent AVANT que la borne
 * ne redevienne illisible. Les valeurs mesurées sont notées en commentaire.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio, color } from "@sigfa/ui";

const NIGHT = color["--night"];
const NIGHT_2 = color["--night-2"];
const SURFACE_1 = color["--surface-1"];

describe("F10: libellés d'action sur carte claire", () => {
  it("--brand-strong (alias --action-label) ≥ 7:1 sur --surface-1", () => {
    // 8.1:1 mesuré avec le brand par défaut (#813B0D sur #FFFFFF).
    expect(contrastRatio(color["--brand-strong"], SURFACE_1)).toBeGreaterThanOrEqual(7);
  });

  it("--ink ≥ 7:1 sur --surface-1 (texte principal des cartes)", () => {
    // 18.4:1 mesuré — la valeur qui était revendiquée à tort pour --action-label.
    expect(contrastRatio(color["--ink"], SURFACE_1)).toBeGreaterThanOrEqual(7);
  });

  it("--brand-contrast ≥ 4.5:1 sur --brand (CTA primaires)", () => {
    // 4.83:1 mesuré (blanc sur #B85513) — minimum absolu DS.
    expect(contrastRatio(color["--brand-contrast"], color["--brand"])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("F6: sémantiques inverses sur fond nuit (consignes, erreurs, SMS)", () => {
  const pairs = [
    ["--success-inv", 7], // 10.6:1 mesuré — « Récupérez votre ticket imprimé »
    ["--danger-inv", 7], // 9.6:1 mesuré — erreurs sur nuit
    ["--info-inv", 7], // 9.7:1 mesuré — bandeaux offline sur nuit
    ["--warning-inv", 7], // 9.9:1 mesuré — affluence sur nuit
  ] as const;

  for (const [token, threshold] of pairs) {
    it(`${token} ≥ ${threshold}:1 sur --night et --night-2`, () => {
      expect(contrastRatio(color[token], NIGHT)).toBeGreaterThanOrEqual(threshold);
      expect(contrastRatio(color[token], NIGHT_2)).toBeGreaterThanOrEqual(threshold);
    });
  }

  it("les sémantiques DIRECTS restent interdits comme texte sur nuit (preuve du besoin)", () => {
    // --success sur --night = 3.49:1, --danger = 3.40:1, --info = 3.41:1 :
    // tous < 7:1. Ce test documente pourquoi les variantes -inv existent.
    for (const token of ["--success", "--danger", "--info"] as const) {
      expect(contrastRatio(color[token], NIGHT)).toBeLessThan(7);
    }
  });
});

describe("F1: états vides lisibles sur fond nuit", () => {
  const designTokensCss = readFileSync(
    resolve(__dirname, "../lib/design-tokens.css"),
    "utf-8",
  );

  it("le kiosque route l'EmptyState @sigfa/ui vers l'encre inverse", () => {
    // Les trois écrans (opérations / conseillers / services) rendent leur état
    // vide sur --night : le pont kiosque doit inverser titre et description.
    expect(designTokensCss).toMatch(/--sig-empty-title:\s*var\(--ink-inverse\)/);
    expect(designTokensCss).toMatch(/--sig-empty-desc:\s*var\(--ink-inverse-soft\)/);
  });

  it("la description d'état vide passe au plancher borne (≥ 24px)", () => {
    // --text-xl = 25px ≥ 24px (règle « texte ≥ 24px » du DS kiosque).
    expect(designTokensCss).toMatch(/--sig-empty-desc-size:\s*var\(--text-xl\)/);
  });

  it("la paire inversée tient le seuil kiosque sur --night", () => {
    // Titre : 17.4:1 mesuré · description : 8.3:1 mesuré.
    expect(contrastRatio(color["--ink-inverse"], NIGHT)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(color["--ink-inverse-soft"], NIGHT)).toBeGreaterThanOrEqual(7);
  });

  it("l'ancienne paire fautive reste détectée comme illisible (1.02:1)", () => {
    // Garde-fou : si quelqu'un repointe le titre vers --ink sur nuit, la
    // preuve chiffrée du bug F1 est ici.
    expect(contrastRatio(color["--ink"], NIGHT)).toBeLessThan(1.5);
  });
});

describe("Moment Ticket — paires or/nuit inchangées", () => {
  it("--gold ≥ 7:1 sur --night (numéro de ticket)", () => {
    // 7.25:1 mesuré — la marge est faible : tout assombrissement de l'or casse ici.
    expect(contrastRatio(color["--gold"], NIGHT)).toBeGreaterThanOrEqual(7);
  });

  it("--ink-inverse ≥ 7:1 sur --night et --night-2", () => {
    expect(contrastRatio(color["--ink-inverse"], NIGHT)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(color["--ink-inverse"], NIGHT_2)).toBeGreaterThanOrEqual(7);
  });
});
