import { defineConfig } from "drizzle-kit";

/**
 * Configuration drizzle-kit pour @sigfa/database (DB-001).
 *
 * - Dialecte PostgreSQL 16, mode strict (aucune migration destructive silencieuse).
 * - Le schéma Drizzle (`src/schema/`) est la SOURCE DE VÉRITÉ du modèle (CLAUDE.md §7).
 * - Les migrations SQL sont générées dans `migrations/` et appliquées telles quelles
 *   sur une PostgreSQL réelle (Testcontainers) — jamais de push implicite en test.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./dist/schema/index.js",
  out: "./migrations",
  strict: true,
  verbose: true,
});
