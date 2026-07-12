import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Leçon f1 : fournir `coverage.exclude` REMPLACE les defaults vitest (defaultCoverageExcludes).
// On les ré-inclut ici explicitement pour ne pas perdre l'exclusion de node_modules, test files, etc.
// Même pattern que packages/contracts/vitest.config.ts.
const vitestDefaultCoverageExcludes = [
  "coverage/**",
  "dist/**",
  "**/node_modules/**",
  "**/[.]**",
  "packages/*/test?(s)/**",
  "**/*.d.ts",
  "**/virtual:*",
  "**/__x00__*",
  "**/\0*",
  "cypress/**",
  "test?(s)/**",
  "test?(-*).?(c|m)[jt]s?(x)",
  "**/*{.,-}{test,spec,bench,benchmark}?(-d).?(c|m)[jt]s?(x)",
  "**/__tests__/**",
  "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
  "**/vitest.{workspace,projects}.[jt]s?(on)",
  "**/.{eslint,mocha,prettier}rc.{?(c|m)js,yml}",
];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
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
      // `include` scope la couverture aux fichiers projet uniquement — sans cela,
      // vitest instrumente node_modules, .next/, etc. et les métriques sont faussées.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        ...vitestDefaultCoverageExcludes,
        // Kiosk-specific exclusions
        "src/mocks/**",
        "src/app/**",          // Next.js App Router — nécessite runtime Next.js
        "src/i18n/request.ts", // next-intl server config (getRequestConfig) — Next.js server-only, non testable en jsdom
        "src/middleware.ts",
        "electron/**",
        ".next/**",
        "out/**",
      ],
    },
    include: [
      "src/**/*.test.{ts,tsx}",
      "src/**/*.spec.{ts,tsx}",
      "electron/**/*.test.ts",
    ],
    exclude: ["node_modules", "dist", ".next", "src/__tests__/visual/**"],
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
      // @sigfa/ui is source-exported (no dist) — resolve its barrel + css entries.
      "@sigfa/ui/tokens.css": resolve(
        import.meta.dirname,
        "../../packages/ui/src/tokens.css"
      ),
      "@sigfa/ui/fonts.css": resolve(
        import.meta.dirname,
        "../../packages/ui/src/fonts.css"
      ),
      "@sigfa/ui/components.css": resolve(
        import.meta.dirname,
        "../../packages/ui/src/components/components.css"
      ),
      "@sigfa/ui": resolve(import.meta.dirname, "../../packages/ui/src/index.ts"),
      // Electron is only available in the Electron runtime — stub for tests
      electron: resolve(import.meta.dirname, "./__mocks__/electron.ts"),
    },
  },
});
