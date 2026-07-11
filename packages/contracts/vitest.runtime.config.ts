import { defineConfig } from "vitest/config";

/**
 * Configuration Vitest pour les tests runtime lourds (Prism + Schemathesis Docker).
 *
 * Ces tests spawent 7 serveurs Prism + 1 conteneur Docker Schemathesis.
 * Ils sont exclus du gate de couverture standard (voir vitest.config.ts) car :
 *   1. L'instrumentation V8 ne peut pas couvrir les processus fils (prism, docker).
 *   2. Sur un runner 2 cœurs (CI), la contention CPU provoque des timeouts intermittents
 *      ("Port 4012 not ready") → le gate rapide échoue de manière opaque.
 *   3. Ces tests ne produisent aucune couverture de ligne utile.
 *
 * Ref leçon : .claude/lessons/etat-local-residuel-masque-la-ci.md
 * Pattern : cf. KIOSK test:visual (séparation gate rapide / tests lourds).
 *
 * Lancer via : pnpm --filter @sigfa/contracts run test:runtime
 */
export default defineConfig({
  test: {
    include: ["src/mock-prism.test.ts"],
    hookTimeout: 150_000,
    testTimeout: 300_000,
    // Pas de couverture : les tests spawent des processus externes non instrumentables
    coverage: {
      enabled: false,
    },
    // Pool threads par défaut, mais timeouts généreux pour absorber la contention
    pool: "forks",
    poolOptions: {
      forks: {
        // Un fork par fichier de test pour isoler les ports Prism
        singleFork: true,
      },
    },
  },
});
