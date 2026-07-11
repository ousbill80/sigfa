import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Correspond aux paths TypeScript : src/* → ./src/*
      src: resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["json"],
      reportsDirectory: "./coverage",
    },
  },
});
