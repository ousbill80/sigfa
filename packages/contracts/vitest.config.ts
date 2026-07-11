import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    hookTimeout: 150_000, // generate (redocly + openapi-typescript × 7) peut prendre > 60s
    coverage: {
      provider: "v8",
      reporter: ["json"],
      reportsDirectory: "./coverage",
      // Exclure generated/ des métriques de couverture — CONTRACT-009a
      exclude: ["generated/**"],
    },
  },
});
