import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
    coverage: {
      provider: "v8",
      reporter: ["json", "text", "html"],
      reportsDirectory: "./coverage",
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
      exclude: [
        "src/mocks/**",
        "electron/**",
        "src/app/**",
        "**/*.config.*",
        "**/*.d.ts",
        "dist/**",
        "coverage/**",
      ],
    },
    include: [
      "src/**/*.test.{ts,tsx}",
      "src/**/*.spec.{ts,tsx}",
      "electron/**/*.test.ts",
    ],
    exclude: ["node_modules", "dist", ".next"],
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      // @sigfa/contracts: createSigfaClient lives in client.ts (not re-exported from index)
      // We point directly to client.js which exports createSigfaClient
      "@sigfa/contracts": resolve(
        import.meta.dirname,
        "../../packages/contracts/dist/src/client.js"
      ),
      // Electron is only available in the Electron runtime — stub for tests
      electron: resolve(import.meta.dirname, "./__mocks__/electron.ts"),
    },
  },
});
