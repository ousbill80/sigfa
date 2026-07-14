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
 * DB-MISSING-COLUMNS-REPORTING-QUEUES — Migration 0016 : réconciliation
 * schéma ↔ code + contrat OpenAPI (2 colonnes manquantes → 500 en prod).
 *
 * Bug 1 : `daily_agency_stats.agent_available_seconds` était absente alors que
 *   aggregate-service.ts / report-build.job.ts / export-build.job.ts / routes/reports.ts
 *   l'écrivent et la lisent déjà (décision D2, temps agent « disponible »).
 * Bug 2 : `queues.open_at` / `queues.close_at` étaient absentes alors que
 *   routes/queues.ts les SELECT/UPDATE et que le contrat (LA LOI) déclare
 *   `openAt`/`closeAt` (format HH:MM) sur la ressource queue.
 *
 * Prouve, sur PostgreSQL 16 réelle (Testcontainers — LA LOI T5) :
 *   - APRÈS la migration : les 3 colonnes existent, type integer/text, nullable ;
 *   - un INSERT `daily_agency_stats` incluant `agent_available_seconds` réussit ;
 *   - un SELECT/UPDATE `open_at`/`close_at` sur `queues` réussit ;
 *   - AVANT (après le down) : ces mêmes opérations échouent `column ... does not exist`
 *     (red run) — la colonne n'existe pas ;
 *   - réversibilité up → down → up validée ;
 *   - `agent_active_seconds` (colonne d'origine) reste intacte (non régressée).
 *
 * Nommés `DB-0016: ...`.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

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

/** Métadonnée (type + nullabilité) d'une colonne via information_schema. */
async function columnMeta(
  harness: DualConnectionHarness,
  table: string,
  column: string
): Promise<{ data_type: string; is_nullable: string } | undefined> {
  const res = await harness.query(
    `SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return res.rows[0] as { data_type: string; is_nullable: string } | undefined;
}

const UP_FILE = "0016_missing_columns_reporting_queues.sql";
const DOWN_FILE = "0016_missing_columns_reporting_queues.down.sql";

describe("DB-0016: migration 0016 — colonnes manquantes reporting + queues (réconciliation code/contrat)", () => {
  let harness: DualConnectionHarness;

  const bank = "01600000-0000-4000-8000-000000000001";
  const agency = "01600000-0000-4000-8000-0000000000a1";
  const service = "01600000-0000-4000-8000-0000000000c1";

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);
    // Fixtures : tenant + agence + service (FK RESTRICT sur daily_agency_stats/queues).
    await harness.query(
      `INSERT INTO banks (id, name, slug) VALUES ('${bank}', 'Banque DB-0016', 'banque-db0016')`
    );
    await harness.query(
      `INSERT INTO agencies (id, bank_id, name) VALUES ('${agency}', '${bank}', 'Agence DB-0016')`
    );
    await harness.query(
      `INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes)
       VALUES ('${service}', '${bank}', '${agency}', 'OC', 'Opérations courantes', 15)`
    );
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it("DB-0016: fichiers up + down présents", () => {
    const files = readdirSync(MIGRATIONS_DIR);
    expect(files).toContain(UP_FILE);
    expect(files).toContain(DOWN_FILE);
  });

  it("DB-0016: après migration — daily_agency_stats.agent_available_seconds existe, integer, nullable", async () => {
    const meta = await columnMeta(harness, "daily_agency_stats", "agent_available_seconds");
    expect(meta, "colonne présente").toBeDefined();
    expect(meta!.data_type).toBe("integer");
    expect(meta!.is_nullable).toBe("YES");
  });

  it("DB-0016: après migration — agent_active_seconds (colonne d'origine) reste intacte (non régressée)", async () => {
    const meta = await columnMeta(harness, "daily_agency_stats", "agent_active_seconds");
    expect(meta, "colonne d'origine préservée").toBeDefined();
    expect(meta!.data_type).toBe("integer");
    expect(meta!.is_nullable).toBe("YES");
  });

  it("DB-0016: après migration — queues.open_at et queues.close_at existent, text, nullable", async () => {
    const openMeta = await columnMeta(harness, "queues", "open_at");
    const closeMeta = await columnMeta(harness, "queues", "close_at");
    expect(openMeta, "open_at présente").toBeDefined();
    expect(openMeta!.data_type).toBe("text");
    expect(openMeta!.is_nullable).toBe("YES");
    expect(closeMeta, "close_at présente").toBeDefined();
    expect(closeMeta!.data_type).toBe("text");
    expect(closeMeta!.is_nullable).toBe("YES");
  });

  it("DB-0016: INSERT daily_agency_stats incluant agent_available_seconds réussit", async () => {
    const res = await harness.query(
      `INSERT INTO daily_agency_stats
         (bank_id, agency_id, service_id, day, agent_active_seconds, agent_available_seconds)
       VALUES ($1, $2, NULL, '2026-07-14', 3600, 5400)
       RETURNING agent_active_seconds, agent_available_seconds`,
      [bank, agency]
    );
    expect(res.rows).toHaveLength(1);
    expect(Number(res.rows[0]!.agent_active_seconds)).toBe(3600);
    expect(Number(res.rows[0]!.agent_available_seconds)).toBe(5400);
  });

  it("DB-0016: SELECT + UPDATE open_at/close_at sur queues réussit (format HH:MM)", async () => {
    const queueId = "01600000-0000-4000-8000-0000000000d1";
    await harness.query(
      `INSERT INTO queues (id, bank_id, agency_id, service_id)
       VALUES ('${queueId}', '${bank}', '${agency}', '${service}')`
    );
    // SELECT (comme routes/queues.ts loadQueue) — colonnes présentes, valeurs NULL par défaut.
    const sel = await harness.query(
      `SELECT id, status, is_open, open_at, close_at FROM queues WHERE id = '${queueId}'`
    );
    expect(sel.rows).toHaveLength(1);
    expect(sel.rows[0]!.open_at).toBeNull();
    expect(sel.rows[0]!.close_at).toBeNull();
    // UPDATE (comme PATCH /queues/:id) — COALESCE des horaires.
    const upd = await harness.query(
      `UPDATE queues
          SET open_at = COALESCE($1, open_at),
              close_at = COALESCE($2, close_at)
        WHERE id = '${queueId}'
        RETURNING open_at, close_at`,
      ["08:00", "17:00"]
    );
    expect(upd.rows[0]!.open_at).toBe("08:00");
    expect(upd.rows[0]!.close_at).toBe("17:00");
  });

  it("DB-0016: RED RUN — après down, les colonnes n'existent plus et les opérations échouent (column does not exist)", async () => {
    await runMigrationFile(harness, DOWN_FILE);

    // Colonnes absentes de information_schema.
    expect(await columnMeta(harness, "daily_agency_stats", "agent_available_seconds")).toBeUndefined();
    expect(await columnMeta(harness, "queues", "open_at")).toBeUndefined();
    expect(await columnMeta(harness, "queues", "close_at")).toBeUndefined();

    // L'INSERT du service échoue (colonne inexistante) — bug prod reproduit.
    await expect(
      harness.query(
        `INSERT INTO daily_agency_stats
           (bank_id, agency_id, service_id, day, agent_available_seconds)
         VALUES ($1, $2, NULL, '2026-07-15', 42)`,
        [bank, agency]
      )
    ).rejects.toThrow(/agent_available_seconds.*does not exist|column .*does not exist/i);

    // Le SELECT open_at/close_at échoue — bug prod reproduit.
    await expect(
      harness.query(`SELECT open_at, close_at FROM queues LIMIT 1`)
    ).rejects.toThrow(/open_at.*does not exist|column .*does not exist/i);
  });

  it("DB-0016: réapplication up après down → les 3 colonnes reviennent (réversibilité up→down→up)", async () => {
    await runMigrationFile(harness, UP_FILE);

    const avail = await columnMeta(harness, "daily_agency_stats", "agent_available_seconds");
    expect(avail?.data_type).toBe("integer");
    expect(avail?.is_nullable).toBe("YES");

    const openMeta = await columnMeta(harness, "queues", "open_at");
    const closeMeta = await columnMeta(harness, "queues", "close_at");
    expect(openMeta?.data_type).toBe("text");
    expect(closeMeta?.data_type).toBe("text");

    // Les opérations passent de nouveau (vert).
    const upd = await harness.query(
      `UPDATE queues SET open_at = '09:00', close_at = '18:00'
        WHERE bank_id = '${bank}' RETURNING open_at, close_at`
    );
    expect(upd.rows[0]!.open_at).toBe("09:00");
    expect(upd.rows[0]!.close_at).toBe("18:00");
  });
});
