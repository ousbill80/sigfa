import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  startPostgresContainer,
  type PostgresHarness,
} from "@sigfa/testing/tenant-isolation";
import { splitStatements } from "./test-support/migrate.js";

/**
 * Migration 0011 — restriction de l'enum `agent_language` à FR/EN
 * (décision PO 2026-07 : DIOULA et BAOULE retirés du périmètre).
 *
 * Prouve, sur PostgreSQL réelle (Testcontainers — LA LOI T5) :
 *   - nettoyage des données : DIOULA/BAOULE retirés de `users.languages`
 *     (repli '{FR}' si vide) ; `tickets.required_language` remis à NULL ;
 *   - le type recréé n'accepte plus que FR/EN (insert DIOULA → rejet) ;
 *   - le défaut '{FR}' de `users.languages` est préservé ;
 *   - down → le type 4 valeurs est restauré (rollback de forme) ;
 *   - up réapplicable après down.
 *
 * Nommés `DB-0011: ...`.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Exécute un fichier de migration (.sql ou .down.sql) statement par statement. */
async function runMigrationFile(harness: PostgresHarness, fileName: string): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, fileName), "utf8");
  for (const statement of splitStatements(sql)) {
    await harness.query(statement);
  }
}

/** Applique toutes les migrations STRICTEMENT antérieures à 0011 (base "avant"). */
async function applyMigrationsBefore0011(harness: PostgresHarness): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .filter((name) => name < "0011")
    .sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    await runMigrationFile(harness, file);
  }
}

describe("DB-0011: migration 0011 — enum agent_language restreint à FR/EN", () => {
  let pg: PostgresHarness;

  const IDS = {
    bank: "b0110000-b011-4b0b-ab0b-b0b0b0b0b0b0",
    agency: "a0110000-a011-4a0a-aa0a-a0a0a0a0a0a0",
    service: "e0110000-e011-4e0e-ae0e-e0e0e0e0e0e0",
    queue: "f0110000-f011-4f0f-af0f-f0f0f0f0f0f0",
    userDioula: "10110000-0000-4000-a000-000000000001",
    userDioulaBaoule: "10110000-0000-4000-a000-000000000002",
    userFrEn: "10110000-0000-4000-a000-000000000003",
    ticketDioula: "20110000-0000-4000-a000-000000000001",
    ticketFr: "20110000-0000-4000-a000-000000000002",
  } as const;

  beforeAll(async () => {
    pg = await startPostgresContainer();
    await applyMigrationsBefore0011(pg);

    // Fixtures "avant migration" : données DIOULA/BAOULE existantes.
    await pg.query(
      `INSERT INTO banks (id, name, slug) VALUES ('${IDS.bank}', 'Banque 0011', 'banque-0011')`
    );
    await pg.query(
      `INSERT INTO agencies (id, bank_id, name) VALUES ('${IDS.agency}', '${IDS.bank}', 'Agence 0011')`
    );
    await pg.query(
      `INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes)
       VALUES ('${IDS.service}', '${IDS.bank}', '${IDS.agency}', 'OC', 'Service 0011', 10)`
    );
    await pg.query(
      `INSERT INTO queues (id, bank_id, agency_id, service_id)
       VALUES ('${IDS.queue}', '${IDS.bank}', '${IDS.agency}', '${IDS.service}')`
    );
    await pg.query(
      `INSERT INTO users (id, bank_id, email, password_hash, first_name, last_name, role, languages) VALUES
       ('${IDS.userDioula}', '${IDS.bank}', 'u1@0011.ci', 'x', 'U', 'Un', 'AGENT', '{FR,DIOULA}'),
       ('${IDS.userDioulaBaoule}', '${IDS.bank}', 'u2@0011.ci', 'x', 'U', 'Deux', 'AGENT', '{DIOULA,BAOULE}'),
       ('${IDS.userFrEn}', '${IDS.bank}', 'u3@0011.ci', 'x', 'U', 'Trois', 'AGENT', '{FR,EN}')`
    );
    await pg.query(
      `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at, required_language) VALUES
       ('${IDS.ticketDioula}', '${IDS.bank}', '${IDS.agency}', '${IDS.queue}', '${IDS.service}', 1, 'KIOSK', 'WAITING', 'db0011trk0000000001', now(), 'DIOULA'),
       ('${IDS.ticketFr}', '${IDS.bank}', '${IDS.agency}', '${IDS.queue}', '${IDS.service}', 2, 'KIOSK', 'WAITING', 'db0011trk0000000002', now(), 'FR')`
    );
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  }, 30_000);

  it("DB-0011: .down.sql présent pour 0011", () => {
    const files = readdirSync(MIGRATIONS_DIR);
    expect(files).toContain("0011_restrict_agent_language.sql");
    expect(files).toContain("0011_restrict_agent_language.down.sql");
  });

  it("DB-0011: up — nettoie users.languages (retrait DIOULA/BAOULE, repli '{FR}' si vide)", async () => {
    await runMigrationFile(pg, "0011_restrict_agent_language.sql");

    const rows = await pg.query(
      `SELECT id, languages::text AS langs FROM users
        WHERE id IN ('${IDS.userDioula}', '${IDS.userDioulaBaoule}', '${IDS.userFrEn}')
        ORDER BY email`
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.langs]));
    expect(byId.get(IDS.userDioula), "FR,DIOULA → {FR}").toBe("{FR}");
    expect(byId.get(IDS.userDioulaBaoule), "DIOULA,BAOULE → repli {FR}").toBe("{FR}");
    expect(byId.get(IDS.userFrEn), "FR,EN inchangé").toBe("{FR,EN}");
  });

  it("DB-0011: up — tickets.required_language DIOULA remis à NULL, FR préservé", async () => {
    const rows = await pg.query(
      `SELECT id, required_language FROM tickets
        WHERE id IN ('${IDS.ticketDioula}', '${IDS.ticketFr}')`
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.required_language]));
    expect(byId.get(IDS.ticketDioula), "DIOULA → NULL").toBeNull();
    expect(byId.get(IDS.ticketFr), "FR préservé").toBe("FR");
  });

  it("DB-0011: up — le type agent_language ne porte plus que FR et EN", async () => {
    const rows = await pg.query(
      `SELECT enumlabel FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'agent_language'
        ORDER BY e.enumsortorder`
    );
    expect(rows.rows.map((r) => r.enumlabel)).toEqual(["FR", "EN"]);
  });

  it("DB-0011: up — insert DIOULA rejeté par le type restreint", async () => {
    await expect(
      pg.query(
        `UPDATE tickets SET required_language = 'DIOULA' WHERE id = '${IDS.ticketFr}'`
      )
    ).rejects.toThrow();
  });

  it("DB-0011: up — défaut '{FR}' de users.languages préservé", async () => {
    await pg.query(
      `INSERT INTO users (id, bank_id, email, password_hash, first_name, last_name, role)
       VALUES ('10110000-0000-4000-a000-000000000004', '${IDS.bank}', 'u4@0011.ci', 'x', 'U', 'Quatre', 'AGENT')`
    );
    const rows = await pg.query(
      `SELECT languages::text AS langs FROM users WHERE email = 'u4@0011.ci'`
    );
    expect(rows.rows[0]?.langs, "défaut {FR} conservé").toBe("{FR}");
  });

  it("DB-0011: down — le type 4 valeurs (FR/DIOULA/BAOULE/EN) est restauré", async () => {
    await runMigrationFile(pg, "0011_restrict_agent_language.down.sql");
    const rows = await pg.query(
      `SELECT enumlabel FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'agent_language'
        ORDER BY e.enumsortorder`
    );
    expect(rows.rows.map((r) => r.enumlabel)).toEqual(["FR", "DIOULA", "BAOULE", "EN"]);
  });

  it("DB-0011: up réapplicable après down (rollback réversible)", async () => {
    await runMigrationFile(pg, "0011_restrict_agent_language.sql");
    const rows = await pg.query(
      `SELECT enumlabel FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'agent_language'
        ORDER BY e.enumsortorder`
    );
    expect(rows.rows.map((r) => r.enumlabel)).toEqual(["FR", "EN"]);
  });
});
