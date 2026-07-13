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
 * DB-NOTIF — Migration 0012 : schéma réel WhatsApp + enums CONTRACT-013.
 *
 * Prouve, sur PostgreSQL réelle (Testcontainers — LA LOI T5) :
 *   - up : enum notification_type gagne POSITION_NEAR / POSITION_NEXT (additif) ;
 *   - up : enum consent_source créé (5 valeurs, INBOUND_WHATSAPP inclus) ;
 *   - up : notification_consents.source acceptée, consentement PAR CANAL préservé
 *     (unicité (bank_id, phone_hash, channel)) ;
 *   - up : tables whatsapp_config / whatsapp_menu_mapping / whatsapp_inbound_messages
 *     présentes, RLS ENABLE + FORCE + policy tenant_isolation, GRANT sigfa_app ;
 *   - down : tables retirées, source + consent_source retirés, notification_type
 *     restauré à 4 valeurs ;
 *   - idempotence : up réapplicable après down.
 *
 * Nommés `DB-0012: ...`.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Exécute un fichier de migration (.sql ou .down.sql) statement par statement. */
async function runMigrationFile(harness: PostgresHarness, fileName: string): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, fileName), "utf8");
  for (const statement of splitStatements(sql)) {
    await harness.query(statement);
  }
}

/** Applique toutes les migrations STRICTEMENT antérieures à 0012 (base "avant"). */
async function applyMigrationsBefore0012(harness: PostgresHarness): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .filter((name) => name < "0012")
    .sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    await runMigrationFile(harness, file);
  }
}

/** Étiquettes d'un type enum, dans l'ordre enumsortorder. */
async function enumLabels(pg: PostgresHarness, typname: string): Promise<string[]> {
  const rows = await pg.query(
    `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = '${typname}'
      ORDER BY e.enumsortorder`
  );
  return rows.rows.map((r) => r.enumlabel as string);
}

/** Existence d'une table publique. */
async function tableExists(pg: PostgresHarness, table: string): Promise<boolean> {
  const rows = await pg.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '${table}'`
  );
  return rows.rows.length > 0;
}

describe("DB-0012: migration 0012 — WhatsApp config + enums CONTRACT-013", () => {
  let pg: PostgresHarness;

  const IDS = {
    bank: "b0120000-b012-4b0b-ab0b-b0b0b0b0b0b0",
    agency: "a0120000-a012-4a0a-aa0a-a0a0a0a0a0a0",
    service: "e0120000-e012-4e0e-ae0e-e0e0e0e0e0e0",
  } as const;

  const WHATSAPP_TABLES = [
    "whatsapp_config",
    "whatsapp_menu_mapping",
    "whatsapp_inbound_messages",
  ] as const;

  beforeAll(async () => {
    pg = await startPostgresContainer();
    await applyMigrationsBefore0012(pg);

    await pg.query(
      `INSERT INTO banks (id, name, slug) VALUES ('${IDS.bank}', 'Banque 0012', 'banque-0012')`
    );
    await pg.query(
      `INSERT INTO agencies (id, bank_id, name) VALUES ('${IDS.agency}', '${IDS.bank}', 'Agence 0012')`
    );
    await pg.query(
      `INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes)
       VALUES ('${IDS.service}', '${IDS.bank}', '${IDS.agency}', 'OC', 'Service 0012', 10)`
    );
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  }, 30_000);

  it("DB-0012: .down.sql présent pour 0012", () => {
    const files = readdirSync(MIGRATIONS_DIR);
    expect(files).toContain("0012_whatsapp_config.sql");
    expect(files).toContain("0012_whatsapp_config.down.sql");
  });

  it("DB-0012: up — notification_type porte 6 valeurs (+ POSITION_NEAR/POSITION_NEXT)", async () => {
    await runMigrationFile(pg, "0012_whatsapp_config.sql");
    const labels = await enumLabels(pg, "notification_type");
    expect(labels).toEqual([
      "TICKET_CONFIRMATION",
      "POSITION_UPDATE",
      "YOUR_TURN",
      "DAILY_REPORT",
      "POSITION_NEAR",
      "POSITION_NEXT",
    ]);
  });

  it("DB-0012: up — consent_source créé (5 valeurs, INBOUND_WHATSAPP inclus)", async () => {
    const labels = await enumLabels(pg, "consent_source");
    expect(labels).toEqual(["AGENT", "KIOSK", "WEB", "INBOUND_WHATSAPP", "IMPORT"]);
  });

  it("DB-0012: up — notification_consents.source (INBOUND_WHATSAPP) + consentement par canal", async () => {
    const phoneHash = "hash-0012-fixed";
    // Opt-in WHATSAPP tracé INBOUND_WHATSAPP.
    await pg.query(
      `INSERT INTO notification_consents (bank_id, phone_encrypted, phone_hash, channel, opted_in, opted_at, source)
       VALUES ('${IDS.bank}', 'v1:enc', '${phoneHash}', 'WHATSAPP', true, now(), 'INBOUND_WHATSAPP')`
    );
    // Même téléphone, canal SMS : consentement DISTINCT (par canal) — pas de conflit d'unicité.
    await pg.query(
      `INSERT INTO notification_consents (bank_id, phone_encrypted, phone_hash, channel, opted_in, source)
       VALUES ('${IDS.bank}', 'v1:enc', '${phoneHash}', 'SMS', false, 'AGENT')`
    );
    const rows = await pg.query(
      `SELECT channel, source FROM notification_consents
        WHERE bank_id = '${IDS.bank}' AND phone_hash = '${phoneHash}' ORDER BY channel`
    );
    expect(rows.rows).toHaveLength(2);
    const byChannel = new Map(rows.rows.map((r) => [r.channel, r.source]));
    expect(byChannel.get("WHATSAPP")).toBe("INBOUND_WHATSAPP");
    expect(byChannel.get("SMS")).toBe("AGENT");
  });

  it("DB-0012: up — source consent_source rejette une valeur hors enum", async () => {
    await expect(
      pg.query(
        `INSERT INTO notification_consents (bank_id, phone_encrypted, phone_hash, channel, opted_in, source)
         VALUES ('${IDS.bank}', 'v1:enc', 'hash-bad', 'WHATSAPP', true, 'NOPE')`
      )
    ).rejects.toThrow();
  });

  it("DB-0012: up — les 3 tables WhatsApp existent", async () => {
    for (const t of WHATSAPP_TABLES) {
      expect(await tableExists(pg, t), `table ${t}`).toBe(true);
    }
  });

  it("DB-0012: up — whatsapp_config : PK bank_id, mapping menu et idempotence entrant", async () => {
    await pg.query(
      `INSERT INTO whatsapp_config (bank_id, business_number, webhook_secret, default_agency_id, enabled)
       VALUES ('${IDS.bank}', '+2250700000000', 'sec', '${IDS.agency}', true)`
    );
    // bank_id est PK : une seconde config pour la même banque est rejetée.
    await expect(
      pg.query(
        `INSERT INTO whatsapp_config (bank_id, webhook_secret) VALUES ('${IDS.bank}', 'sec2')`
      )
    ).rejects.toThrow();

    await pg.query(
      `INSERT INTO whatsapp_menu_mapping (bank_id, keyword, service_id)
       VALUES ('${IDS.bank}', '1', '${IDS.service}')`
    );
    // Unicité (bank_id, keyword).
    await expect(
      pg.query(
        `INSERT INTO whatsapp_menu_mapping (bank_id, keyword, service_id)
         VALUES ('${IDS.bank}', '1', '${IDS.service}')`
      )
    ).rejects.toThrow();

    await pg.query(
      `INSERT INTO whatsapp_inbound_messages (bank_id, provider_message_id)
       VALUES ('${IDS.bank}', 'wamid.1')`
    );
    // Unicité (bank_id, provider_message_id) — idempotence.
    const dup = await pg.query(
      `INSERT INTO whatsapp_inbound_messages (bank_id, provider_message_id)
       VALUES ('${IDS.bank}', 'wamid.1')
       ON CONFLICT (bank_id, provider_message_id) DO NOTHING RETURNING id`
    );
    expect(dup.rows).toHaveLength(0);
  });

  it("DB-0012: up — RLS ENABLE + FORCE + policy tenant_isolation sur les 3 tables WhatsApp", async () => {
    const rls = await pg.query(`
      SELECT pt.tablename, pt.rowsecurity, pc.relforcerowsecurity AS force
      FROM pg_tables pt
      JOIN pg_class pc ON pc.relname = pt.tablename AND pc.relnamespace = 'public'::regnamespace
      WHERE pt.schemaname = 'public'
        AND pt.tablename = ANY(ARRAY['whatsapp_config','whatsapp_menu_mapping','whatsapp_inbound_messages'])
    `);
    expect(rls.rows).toHaveLength(3);
    for (const row of rls.rows) {
      expect(row.rowsecurity, `${String(row.tablename)} RLS`).toBe(true);
      expect(row.force, `${String(row.tablename)} FORCE`).toBe(true);
    }
    const policies = await pg.query(`
      SELECT tablename FROM pg_policies
      WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
        AND tablename = ANY(ARRAY['whatsapp_config','whatsapp_menu_mapping','whatsapp_inbound_messages'])
    `);
    expect(policies.rows).toHaveLength(3);
  });

  it("DB-0012: up — GRANT sigfa_app présent sur les 3 tables WhatsApp", async () => {
    for (const t of WHATSAPP_TABLES) {
      const grants = await pg.query(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = '${t}' AND grantee = 'sigfa_app'
          ORDER BY privilege_type`
      );
      const privs = grants.rows.map((r) => r.privilege_type as string);
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(privs, `${t}.${p}`).toContain(p);
      }
    }
  });

  it("DB-0012: down — tables WhatsApp + source retirés, notification_type restauré à 4 valeurs", async () => {
    await runMigrationFile(pg, "0012_whatsapp_config.down.sql");

    for (const t of WHATSAPP_TABLES) {
      expect(await tableExists(pg, t), `table ${t} supprimée`).toBe(false);
    }
    const consentSource = await enumLabels(pg, "consent_source");
    expect(consentSource, "consent_source supprimé").toHaveLength(0);
    const sourceCol = await pg.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notification_consents' AND column_name = 'source'`
    );
    expect(sourceCol.rows, "colonne source retirée").toHaveLength(0);
    const types = await enumLabels(pg, "notification_type");
    expect(types).toEqual([
      "TICKET_CONFIRMATION",
      "POSITION_UPDATE",
      "YOUR_TURN",
      "DAILY_REPORT",
    ]);
  });

  it("DB-0012: up réapplicable après down (rollback réversible)", async () => {
    await runMigrationFile(pg, "0012_whatsapp_config.sql");
    expect(await tableExists(pg, "whatsapp_config"), "whatsapp_config recréée").toBe(true);
    const types = await enumLabels(pg, "notification_type");
    expect(types).toContain("POSITION_NEAR");
    expect(types).toContain("POSITION_NEXT");
    const consentSource = await enumLabels(pg, "consent_source");
    expect(consentSource).toContain("INBOUND_WHATSAPP");
  });
});
