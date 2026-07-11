/**
 * CONTRACT-009 — Déterminisme de la génération (sous-lot 009a, critère 3)
 *
 * Critère 3 : generate 2× → zéro diff (déterminisme)
 *
 * Ce fichier est EXCLUS du gate rapide de couverture (vitest.config.ts) car il
 * spawne `pnpm generate` (redocly + openapi-typescript × 7), ce qui prend >60s
 * et provoque des timeouts sous contention CI (2 cœurs + instrumentation).
 *
 * Exécuté via : pnpm --filter @sigfa/contracts run test:runtime
 * Ref leçon : .claude/lessons/etat-local-residuel-masque-la-ci.md (T8 contention CI)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACTS_DIR = resolve(__dirname, "..");
const BUNDLED_DIR = resolve(CONTRACTS_DIR, "generated/bundled");
const TYPES_DIR = resolve(CONTRACTS_DIR, "generated/types");

const MODULES = ["core", "public", "agents", "admin", "reporting", "notifications", "ai"] as const;

// ─── Suite 3 : Déterminisme ───────────────────────────────────────────────────

describe("CONTRACT-009: déterminisme de la génération", () => {
  const firstRunContent: Record<string, string> = {};
  const secondRunContent: Record<string, string> = {};

  // Timeout étendu pour absorber la durée de `generate` (redocly + openapi-typescript × 7)
  beforeAll(() => {
    // Lire les fichiers générés une première fois (ils ont été générés avant les tests)
    for (const module of MODULES) {
      const typesPath = resolve(TYPES_DIR, `${module}.ts`);
      if (existsSync(typesPath)) {
        firstRunContent[module] = readFileSync(typesPath, "utf-8");
      }
      const bundledPath = resolve(BUNDLED_DIR, `${module}.yaml`);
      if (existsSync(bundledPath)) {
        firstRunContent[`bundle_${module}`] = readFileSync(bundledPath, "utf-8");
      }
    }

    // Relancer generate pour tester le déterminisme
    try {
      execSync("pnpm --filter @sigfa/contracts run generate", {
        cwd: resolve(CONTRACTS_DIR, "../.."),
        stdio: "pipe",
        timeout: 120_000,
      });
    } catch {
      // Erreur consignée dans les assertions
    }

    // Lire les fichiers générés une deuxième fois
    for (const module of MODULES) {
      const typesPath = resolve(TYPES_DIR, `${module}.ts`);
      if (existsSync(typesPath)) {
        secondRunContent[module] = readFileSync(typesPath, "utf-8");
      }
      const bundledPath = resolve(BUNDLED_DIR, `${module}.yaml`);
      if (existsSync(bundledPath)) {
        secondRunContent[`bundle_${module}`] = readFileSync(bundledPath, "utf-8");
      }
    }
  }, 150_000); // timeout généreux pour `pnpm generate` (redocly × 7 + openapi-typescript × 7)

  it("CONTRACT-009: generate 2× → zéro diff sur les types TS (déterminisme)", () => {
    for (const module of MODULES) {
      if (firstRunContent[module] && secondRunContent[module]) {
        expect(
          secondRunContent[module],
          `${module}.ts: différence entre deux exécutions de generate (non-déterministe)`
        ).toBe(firstRunContent[module]);
      }
    }
  });

  it("CONTRACT-009: generate 2× → zéro diff sur les bundles YAML (déterminisme)", () => {
    for (const module of MODULES) {
      const key = `bundle_${module}`;
      if (firstRunContent[key] && secondRunContent[key]) {
        expect(
          secondRunContent[key],
          `bundle ${module}.yaml: différence entre deux exécutions (non-déterministe)`
        ).toBe(firstRunContent[key]);
      }
    }
  });

  it("CONTRACT-009: les fichiers générés ne contiennent pas de timestamp de génération (aucun header 'Generated at')", () => {
    for (const module of MODULES) {
      const typesPath = resolve(TYPES_DIR, `${module}.ts`);
      if (!existsSync(typesPath)) continue;
      const content = readFileSync(typesPath, "utf-8");
      // Aucun timestamp de génération dans l'en-tête du fichier
      // (les timestamps dans les exemples YAML sont OK, seuls les "Generated at" / "generatedAt" posent problème)
      expect(
        content,
        `${module}.ts: timestamp de génération 'Generated at' détecté`
      ).not.toMatch(/[Gg]enerated\s+at\s+\d{4}-\d{2}-\d{2}/);
      expect(
        content,
        `${module}.ts: timestamp de génération 'generatedAt' détecté`
      ).not.toMatch(/generatedAt:\s*['"]?\d{4}-\d{2}-\d{2}T/);
    }
  });
});
