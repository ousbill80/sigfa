import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * Config Vitest DÉDIÉE au mutation testing (SEC-005).
 *
 * StrykerJS lance le runner Vitest avec CETTE config. Elle scope le run aux
 * DEUX seules suites déterministes et rapides couvrant le périmètre muté
 * (`queue-engine` + `reporting/sla-engine`) — jamais les suites Testcontainers
 * (PostgreSQL/Redis réels), qui rendraient le run lent et flaky et n'ajoutent
 * aucun signal de mutation sur ces fichiers purs / fake-Tx.
 *
 * Déterminisme : aucun I/O réseau, aucune horloge cachée (l'horloge de
 * `isDayPartial` est injectée), aucun conteneur — le score est reproductible.
 */
export default defineConfig({
  resolve: {
    alias: {
      src: resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    // Périmètre STRICT : seules les 2 suites unitaires du cœur muté.
    include: [
      "src/services/queue-engine.test.ts",
      "src/reporting/sla-engine.test.ts",
    ],
    // Timeouts serrés : ces suites sont pures/fake-Tx (millisecondes) — un test
    // qui dépasse largement = mutant infini détecté par timeout Stryker.
    testTimeout: 5_000,
    hookTimeout: 5_000,
  },
});
