import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Imports absolus depuis src/ (CLAUDE.md §7) — évite les imports parents relatifs.
      src: resolve(rootDir, "src"),
    },
  },
  test: {
    // Les tests d'intégration démarrent une PostgreSQL réelle (Testcontainers) :
    // laisser le temps au conteneur de démarrer et aux migrations de s'appliquer.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Clés de TEST pour le module de chiffrement DB-008 (phone-cipher.ts échoue au
    // chargement si elles sont absentes — fail-fast). Ces valeurs ne sont utilisées
    // qu'en test ; la production les fournit via .env (voir .env.example).
    env: {
      PHONE_ENCRYPTION_KEY: "0".repeat(64),
      PHONE_HASH_KEY: "sigfa-test-hmac-key-db008",
    },
    coverage: {
      provider: "v8",
      reporter: ["json", "text-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/index.ts", "**/__fixtures__/**"],
    },
  },
});
