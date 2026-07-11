import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PostgresHarness } from "@sigfa/testing/tenant-isolation";

/**
 * Utilitaire de test : applique les migrations SQL générées par drizzle-kit
 * sur une PostgreSQL réelle (Testcontainers). Aucun mock — LA LOI T5.
 *
 * Les fichiers `.sql` de `migrations/` sont lus dans l'ordre lexicographique
 * (numérotation séquentielle drizzle-kit `0000_...`, `0001_...`) et exécutés
 * tels quels. Les instructions sont séparées par le marqueur drizzle
 * `--> statement-breakpoint`.
 */

/** Répertoire des migrations, relatif à ce fichier (`src/test-support/`). */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/**
 * Découpe le contenu d'un fichier de migration drizzle en instructions SQL.
 * @param sql - Contenu brut du fichier `.sql`
 * @returns Instructions SQL non vides, dans l'ordre
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * Liste les fichiers de migration `.sql` triés par ordre d'application.
 * @returns Chemins absolus des migrations, ordre lexicographique croissant
 */
export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(MIGRATIONS_DIR, name));
}

/**
 * Applique toutes les migrations générées sur la base cible.
 * @param harness - Harness PostgreSQL Testcontainers
 * @throws Si aucune migration n'est présente (schéma non généré)
 */
export async function applyMigrations(harness: PostgresHarness): Promise<void> {
  const files = listMigrationFiles();
  if (files.length === 0) {
    throw new Error(
      "Aucune migration SQL trouvée dans packages/database/migrations/ — exécuter `pnpm db:generate`."
    );
  }
  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    for (const statement of splitStatements(sql)) {
      await harness.query(statement);
    }
  }
}
