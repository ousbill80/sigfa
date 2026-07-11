import { defineConfig } from "vitest/config";

/**
 * Configuration Vitest pour les tests runtime lourds (Prism + Docker + génération).
 *
 * Tests inclus et leur justification :
 *
 *   mock-prism.test.ts          — spawne 7 serveurs Prism + 1 conteneur Docker Schemathesis
 *   contract-diff.test.ts       — spawne Docker oasdiff (~16s) + check-generated-sync (pnpm generate)
 *   bundle-determinism.test.ts  — spawne `pnpm generate` 2× pour vérifier le déterminisme
 *
 * Ces tests sont exclus du gate de couverture standard (voir vitest.config.ts) car :
 *   1. L'instrumentation V8 ne peut pas couvrir les processus fils (prism, docker, generate).
 *   2. Sur un runner 2 cœurs (CI), la contention CPU provoque des timeouts intermittents
 *      ("Port 4012 not ready") → le gate rapide échoue de manière opaque.
 *   3. Ces tests ne produisent aucune couverture de ligne utile.
 *
 * Ref leçon : .claude/lessons/etat-local-residuel-masque-la-ci.md (T8 contention CI)
 * Pattern : cf. KIOSK test:visual (séparation gate rapide / tests lourds).
 *
 * Lancer via : pnpm --filter @sigfa/contracts run test:runtime
 */
export default defineConfig({
  test: {
    include: [
      "src/mock-prism.test.ts",
      "src/contract-diff.test.ts",
      "src/bundle-determinism.test.ts",
    ],
    hookTimeout: 150_000,
    testTimeout: 300_000,
    // Pas de couverture : les tests spawent des processus externes non instrumentables
    coverage: {
      enabled: false,
    },
    // Pool forks pour isoler les ports Prism et les processus Docker
    pool: "forks",
    poolOptions: {
      forks: {
        // Un fork par fichier de test pour isoler les ports Prism
        singleFork: true,
      },
    },
  },
});
