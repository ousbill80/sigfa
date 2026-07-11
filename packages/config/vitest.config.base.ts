import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["json"],
      reportsDirectory: "./coverage",
      // Exclure les fixtures de la mesure de couverture (INFRA-007: C1)
      exclude: ["**/__fixtures__/**"],
    },
  },
});
