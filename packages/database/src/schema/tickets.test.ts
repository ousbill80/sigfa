import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  startPostgresContainer,
  type PostgresHarness,
} from "@sigfa/testing/tenant-isolation";
import { tickets } from "./tickets.js";
import { agentLanguageEnum } from "./enums.js";
import { applyMigrations } from "src/test-support/migrate.js";

/**
 * DB-010 — Tests pour tickets.required_language.
 *
 * Couvre :
 *   - Structure Drizzle in-process (sans base) : colonne présente, nullable, type enum
 *   - Assertion base réelle (Testcontainers PostgreSQL 16) :
 *       · NULL par défaut à l'insertion
 *       · Toutes les valeurs de langue acceptées (FR/EN — décision PO 2026-07,
 *         DIOULA/BAOULE retirés par la migration 0011)
 *       · Valeur hors-enum rejetée par la base
 *       · Mise à jour de la valeur (nullable → valeur → NULL)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Tests structurels in-process (sans base)
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-010: tickets.required_language — structure Drizzle (in-process)", () => {
  it("DB-010: tickets.required_language présente dans le schéma Drizzle", () => {
    const config = getTableConfig(tickets);
    const col = config.columns.find((c) => c.name === "required_language");
    expect(col, "required_language doit être définie dans le schéma tickets").toBeDefined();
  });

  it("DB-010: tickets.required_language nullable (NULL par défaut — préférence optionnelle)", () => {
    const config = getTableConfig(tickets);
    const col = config.columns.find((c) => c.name === "required_language");
    expect(col?.notNull, "required_language doit être nullable").toBeFalsy();
  });

  it("DB-010: tickets.required_language est de type PgEnumColumn (enum agent_language)", () => {
    const config = getTableConfig(tickets);
    const col = config.columns.find((c) => c.name === "required_language");
    expect(col?.columnType, "required_language doit être un PgEnumColumn").toBe("PgEnumColumn");
  });

  it("DB-010: agentLanguageEnum porte exactement les 2 valeurs de langue (FR/EN)", () => {
    expect(agentLanguageEnum.enumValues).toEqual(["FR", "EN"]);
    expect(agentLanguageEnum.enumValues).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tests d'intégration en base réelle (Testcontainers)
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-010: tickets.required_language — assertions base réelle (Testcontainers)", () => {
  let pg: PostgresHarness;

  /** UUIDs de fixture déterministes (sous-ensemble minimal pour insérer un ticket). */
  const IDS = {
    bank: "b0b00000-b0b0-4b0b-ab0b-b0b0b0b0b0b0",
    agency: "a0a00000-a0a0-4a0a-aa0a-a0a0a0a0a0a0",
    service: "e0e00000-e0e0-4e0e-ae0e-e0e0e0e0e0e0",
    queue: "f0f00000-f0f0-4f0f-af0f-f0f0f0f0f0f0",
  } as const;

  beforeAll(async () => {
    pg = await startPostgresContainer();
    await applyMigrations(pg);

    // Fixtures minimales pour pouvoir insérer un ticket (contraintes FK).
    await pg.query(
      `INSERT INTO banks (id, name, slug) VALUES ('${IDS.bank}', 'Banque Test DB010', 'banque-db010')`
    );
    await pg.query(
      `INSERT INTO agencies (id, bank_id, name, weekly_schedule)
       VALUES ('${IDS.agency}', '${IDS.bank}', 'Agence DB010',
               '{"monday":{"start":"08:00","end":"17:00"}}'::jsonb)`
    );
    await pg.query(
      `INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes)
       VALUES ('${IDS.service}', '${IDS.bank}', '${IDS.agency}', 'DB', 'Service DB010', 10)`
    );
    await pg.query(
      `INSERT INTO queues (id, bank_id, agency_id, service_id)
       VALUES ('${IDS.queue}', '${IDS.bank}', '${IDS.agency}', '${IDS.service}')`
    );
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  }, 30_000);

  it("DB-010: required_language NULL par défaut à l'insertion (aucune valeur fournie)", async () => {
    const ticketId = "d0100000-0000-4000-a000-000000000001";
    await pg.query(
      `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at)
       VALUES ('${ticketId}', '${IDS.bank}', '${IDS.agency}', '${IDS.queue}', '${IDS.service}',
               1, 'KIOSK', 'WAITING', 'db010trk00000000001', now())`
    );
    const result = await pg.query(
      `SELECT required_language FROM tickets WHERE id = '${ticketId}'`
    );
    expect(result.rows[0]?.required_language, "required_language doit être NULL par défaut").toBeNull();
  });

  it("DB-010: required_language accepte FR", async () => {
    const ticketId = "d0100000-0000-4000-a000-000000000002";
    await pg.query(
      `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at, required_language)
       VALUES ('${ticketId}', '${IDS.bank}', '${IDS.agency}', '${IDS.queue}', '${IDS.service}',
               2, 'KIOSK', 'WAITING', 'db010trk00000000002', now(), 'FR')`
    );
    const result = await pg.query(
      `SELECT required_language FROM tickets WHERE id = '${ticketId}'`
    );
    expect(result.rows[0]?.required_language).toBe("FR");
  });

  it("DB-010: required_language rejette DIOULA (retiré du périmètre — décision PO 2026-07)", async () => {
    await expect(
      pg.query(
        `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at, required_language)
         VALUES (gen_random_uuid(), '${IDS.bank}', '${IDS.agency}', '${IDS.queue}', '${IDS.service}',
                 3, 'KIOSK', 'WAITING', 'db010trk00000000003', now(), 'DIOULA')`
      )
    ).rejects.toThrow();
  });

  it("DB-010: required_language rejette BAOULE (retiré du périmètre — décision PO 2026-07)", async () => {
    await expect(
      pg.query(
        `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at, required_language)
         VALUES (gen_random_uuid(), '${IDS.bank}', '${IDS.agency}', '${IDS.queue}', '${IDS.service}',
                 4, 'KIOSK', 'WAITING', 'db010trk00000000004', now(), 'BAOULE')`
      )
    ).rejects.toThrow();
  });

  it("DB-010: required_language accepte EN", async () => {
    const ticketId = "d0100000-0000-4000-a000-000000000005";
    await pg.query(
      `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at, required_language)
       VALUES ('${ticketId}', '${IDS.bank}', '${IDS.agency}', '${IDS.queue}', '${IDS.service}',
               5, 'KIOSK', 'WAITING', 'db010trk00000000005', now(), 'EN')`
    );
    const result = await pg.query(
      `SELECT required_language FROM tickets WHERE id = '${ticketId}'`
    );
    expect(result.rows[0]?.required_language).toBe("EN");
  });

  it("DB-010: valeur hors-enum rejetée par la contrainte de type PostgreSQL", async () => {
    await expect(
      pg.query(
        `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at, required_language)
         VALUES (gen_random_uuid(), '${IDS.bank}', '${IDS.agency}', '${IDS.queue}', '${IDS.service}',
                 99, 'KIOSK', 'WAITING', 'db010trk00000000099', now(), 'BAMBARA')`
      )
    ).rejects.toThrow();
  });

  it("DB-010: required_language peut être mis à jour vers NULL (préférence révocable)", async () => {
    const ticketId = "d0100000-0000-4000-a000-000000000006";
    await pg.query(
      `INSERT INTO tickets (id, bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at, required_language)
       VALUES ('${ticketId}', '${IDS.bank}', '${IDS.agency}', '${IDS.queue}', '${IDS.service}',
               6, 'KIOSK', 'WAITING', 'db010trk00000000006', now(), 'FR')`
    );
    // Confirme la valeur initiale
    const before = await pg.query(
      `SELECT required_language FROM tickets WHERE id = '${ticketId}'`
    );
    expect(before.rows[0]?.required_language).toBe("FR");

    // Remet à NULL
    await pg.query(
      `UPDATE tickets SET required_language = NULL WHERE id = '${ticketId}'`
    );
    const after = await pg.query(
      `SELECT required_language FROM tickets WHERE id = '${ticketId}'`
    );
    expect(after.rows[0]?.required_language, "required_language doit pouvoir redevenir NULL").toBeNull();
  });

  it("DB-010: colonne required_language présente dans information_schema avec type agent_language", async () => {
    const result = await pg.query(
      `SELECT data_type, udt_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tickets'
          AND column_name = 'required_language'`
    );
    expect(result.rows.length, "La colonne required_language doit exister dans information_schema").toBe(1);
    expect(result.rows[0]?.udt_name, "Type UDT doit être agent_language").toBe("agent_language");
    expect(result.rows[0]?.is_nullable, "La colonne doit être nullable (YES)").toBe("YES");
  });
});
