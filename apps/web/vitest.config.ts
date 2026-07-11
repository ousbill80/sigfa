import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "./coverage",
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/test/**",
        // Next.js App Router pages/layouts/routes need the Next.js runtime — excluded from unit coverage
        "src/app/**",
        "src/middleware.ts",
        // Old skeleton (not part of WEB-001 feature code)
        "src/index.ts",
        // Pure re-export barrel aliasing @sigfa/contracts (no logic)
        "src/lib/contracts-entry.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // @sigfa/contracts: the package barrel drags in node-only OPENAPI_PATHS,
      // so we alias to a browser-safe entry re-exporting the realtime events +
      // typed client factory (both node-free). See lib/contracts-entry.ts.
      "@sigfa/contracts": path.resolve(__dirname, "./src/lib/contracts-entry.ts"),
    },
  },
});
