import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["json"],
      reportsDirectory: "./coverage",
      // Exclure les fixtures de la mesure de couverture (INFRA-007: C1),
      // SANS écraser les exclusions par défaut de vitest (tests, *.config.*…).
      exclude: [...coverageConfigDefaults.exclude, "**/__fixtures__/**"],
    },
  },
});
