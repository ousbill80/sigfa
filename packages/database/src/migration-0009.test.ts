import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  startPostgresContainerWithRoles,
  type DualConnectionHarness,
} from "@sigfa/testing/tenant-isolation";
import { applyMigrations, splitStatements } from "./test-support/migrate.js";

/**
 * MODEL-DB-A — Migration 0009 : up / down / idempotence + backfill.
 *
 * - Applique toutes les migrations (up), vérifie 1 opération « défaut » par service.
 * - Réapplique la migration 0009 (idempotence backfill : zéro doublon).
 * - Applique le down 0009 (drop propre), puis réapplique up (rollback → réapplication).
 *
 * Nommés `MODEL-DB-A: ...`.
 */

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations"
);

/** Exécute un fichier de migration (.sql ou .down.sql) statement par statement. */
async function runMigrationFile(
  harness: DualConnectionHarness,
  fileName: string
): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, fileName), "utf8");
  for (const statement of splitStatements(sql)) {
    await harness.query(statement);
  }
}

describe("MODEL-DB-A: migration 0009 — up/down/idempotence + backfill", () => {
  let harness: DualConnectionHarness;

  const bank = "c0000000-0000-4000-8000-0000000000c1";
  const agency = "ca000000-0000-4000-8000-0000000000c1";
  const svc1 = "c5000000-0000-4000-8000-0000000000c1";
  const svc2 = "c5000000-0000-4000-8000-0000000000c2";

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);
    // Fixtures : 2 services existants (pour prouver le backfill par service).
    await harness.query(
      `INSERT INTO banks (id, name, slug) VALUES ('${bank}', 'Banque Backfill', 'banque-backfill')`
    );
    await harness.query(
      `INSERT INTO agencies (id, bank_id, name) VALUES ('${agency}', '${bank}', 'Agence Backfill')`
    );
    await harness.query(`INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes) VALUES
      ('${svc1}', '${bank}', '${agency}', 'OC', 'Opérations courantes', 15),
      ('${svc2}', '${bank}', '${agency}', 'OA', 'Ouverture de compte', 30)`);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it("MODEL-DB-A: .down.sql présent pour 0009", () => {
    const files = readdirSync(MIGRATIONS_DIR);
    expect(files).toContain("0009_operations.sql");
    expect(files).toContain("0009_operations.down.sql");
  });

  it("MODEL-DB-A: fixtures — les services insérés AVANT le backfill sont sans opération", async () => {
    // Le beforeAll a inséré les services APRÈS applyMigrations : le backfill de 0009
    // a déjà tourné sur une base vide de services. On (ré)exécute le backfill explicitement.
    await runMigrationFile(harness, "0009_operations.sql");
    const before = await harness.query(
      `SELECT COUNT(*) AS cnt FROM operations WHERE service_id IN ('${svc1}', '${svc2}')`
    );
    expect(Number(before.rows[0]?.cnt)).toBe(2);
  });

  it("MODEL-DB-A: backfill — exactement 1 opération défaut par service (code = code service, sla NULL)", async () => {
    const rows = await harness.query(
      `SELECT service_id, code, sla_minutes, display_order, is_active
       FROM operations WHERE service_id IN ('${svc1}', '${svc2}') ORDER BY code`
    );
    expect(rows.rows).toHaveLength(2);
    const op1 = rows.rows.find((r) => r.service_id === svc1);
    const op2 = rows.rows.find((r) => r.service_id === svc2);
    expect(op1?.code).toBe("OC");
    expect(op2?.code).toBe("OA");
    expect(op1?.sla_minutes, "sla_minutes NULL → hérite du service").toBeNull();
    expect(op1?.is_active).toBe(true);
    expect(Number(op1?.display_order)).toBe(0);
  });

  it("MODEL-DB-A: backfill idempotent — réexécution de 0009 → zéro doublon", async () => {
    await runMigrationFile(harness, "0009_operations.sql");
    await runMigrationFile(harness, "0009_operations.sql");
    const after = await harness.query(
      `SELECT COUNT(*) AS cnt FROM operations WHERE service_id IN ('${svc1}', '${svc2}')`
    );
    expect(Number(after.rows[0]?.cnt), "toujours 1 opération défaut par service").toBe(2);
  });

  it("MODEL-DB-A: down 0009 → table operations et colonne tickets.operation_id supprimées", async () => {
    await runMigrationFile(harness, "0009_operations.down.sql");

    const tbl = await harness.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'operations'`
    );
    expect(tbl.rows, "operations supprimée").toHaveLength(0);

    const col = await harness.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'operation_id'`
    );
    expect(col.rows, "tickets.operation_id supprimée").toHaveLength(0);
  });

  it("MODEL-DB-A: réapplication up après down → operations + operation_id de retour (rollback réversible)", async () => {
    await runMigrationFile(harness, "0009_operations.sql");

    const tbl = await harness.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'operations'`
    );
    expect(tbl.rows, "operations recréée").toHaveLength(1);

    const col = await harness.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'operation_id'`
    );
    expect(col.rows[0]?.is_nullable, "operation_id NULLABLE").toBe("YES");

    // Backfill re-tourné : 1 opération défaut par service à nouveau.
    const cnt = await harness.query(
      `SELECT COUNT(*) AS cnt FROM operations WHERE service_id IN ('${svc1}', '${svc2}')`
    );
    expect(Number(cnt.rows[0]?.cnt)).toBe(2);
  });
});
