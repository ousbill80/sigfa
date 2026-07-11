import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["json"],
      reportsDirectory: "./coverage",
      // Exclure generated/ des métriques de couverture — CONTRACT-009a
      exclude: ["generated/**"],
    },
  },
});
