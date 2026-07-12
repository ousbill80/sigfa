import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  startPostgresContainer,
  startPostgresContainerWithRoles,
  assertTenantIsolated,
} from "@sigfa/testing/tenant-isolation";
import type {
  PostgresHarness,
  DualConnectionHarness,
} from "@sigfa/testing/tenant-isolation";
import { operations } from "./operations.js";
import { tickets } from "./tickets.js";
import { withTenant } from "src/tenant.js";
import { applyMigrations } from "src/test-support/migrate.js";

/**
 * MODEL-DB-A — Tests du schéma `operations` + `tickets.operation_id` + RLS.
 *
 * TDD rouge→vert : les assertions base réelle échouent AVANT la migration 0009
 * (table `operations` et colonne `tickets.operation_id` absentes).
 * Nommés `MODEL-DB-A: ...` (mapping critères EARS ↔ tests).
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Structure Drizzle in-process (sans base)
// ─────────────────────────────────────────────────────────────────────────────

describe("MODEL-DB-A: operations — structure Drizzle (in-process)", () => {
  it("MODEL-DB-A: operations expose bank_id + agency_id NOT NULL (dénormalisés pour RLS/scope)", () => {
    const config = getTableConfig(operations);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    const agencyId = config.columns.find((c) => c.name === "agency_id");
    expect(bankId?.notNull, "bank_id NOT NULL").toBe(true);
    expect(agencyId?.notNull, "agency_id NOT NULL").toBe(true);
  });

  it("MODEL-DB-A: operations.service_id FK NOT NULL vers services (RESTRICT)", () => {
    const config = getTableConfig(operations);
    const serviceId = config.columns.find((c) => c.name === "service_id");
    expect(serviceId?.notNull, "service_id NOT NULL").toBe(true);
    for (const fk of config.foreignKeys) {
      expect(fk.onDelete, "toutes les FK en RESTRICT").toBe("restrict");
    }
    expect(config.foreignKeys.length, "≥3 FK (bank, agency, service)").toBeGreaterThanOrEqual(3);
  });

  it("MODEL-DB-A: operations.sla_minutes NULLABLE (NULL → hérite du service, D4)", () => {
    const config = getTableConfig(operations);
    const sla = config.columns.find((c) => c.name === "sla_minutes");
    expect(sla, "sla_minutes présente").toBeDefined();
    expect(sla?.notNull, "sla_minutes doit être nullable").toBeFalsy();
  });

  it("MODEL-DB-A: operations n'a AUCUNE colonne priority (D4)", () => {
    const config = getTableConfig(operations);
    const priority = config.columns.find((c) => c.name === "priority");
    expect(priority, "aucune colonne priority sur operations").toBeUndefined();
  });

  it("MODEL-DB-A: operations — CHECK code format + unicité (service_id, code)", () => {
    const config = getTableConfig(operations);
    expect(config.checks.map((c) => c.name)).toContain("operations_code_format");
    expect(config.checks.map((c) => c.name)).toContain("operations_sla_minutes_positive");
    expect(config.uniqueConstraints.map((u) => u.name)).toContain(
      "operations_service_id_code_key"
    );
  });

  it("MODEL-DB-A: operations a un index bank_id-first (convention F2)", () => {
    const config = getTableConfig(operations);
    const hasBankFirst = config.indexes.some((index) => {
      const first = index.config.columns[0];
      return (
        first !== undefined &&
        "name" in first &&
        (first as { name: string }).name === "bank_id"
      );
    });
    expect(hasBankFirst, "index bank_id-first").toBe(true);
  });

  it("MODEL-DB-A: tickets.operation_id NULLABLE FK RESTRICT ; service_id CONSERVÉ NOT NULL", () => {
    const config = getTableConfig(tickets);
    const operationId = config.columns.find((c) => c.name === "operation_id");
    const serviceId = config.columns.find((c) => c.name === "service_id");
    expect(operationId, "operation_id présente").toBeDefined();
    expect(operationId?.notNull, "operation_id doit être nullable").toBeFalsy();
    expect(serviceId?.notNull, "service_id reste NOT NULL").toBe(true);
    const fk = config.foreignKeys.find((f) =>
      f.reference().columns.some((col) => col.name === "operation_id")
    );
    expect(fk, "FK operation_id présente").toBeDefined();
    expect(fk?.onDelete, "operation_id FK RESTRICT").toBe("restrict");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Assertions base réelle (Testcontainers PG16)
// ─────────────────────────────────────────────────────────────────────────────

describe("MODEL-DB-A: operations — base réelle (Testcontainers)", () => {
  let pg: PostgresHarness;

  const IDS = {
    bank: "0b000000-0b00-4b00-ab00-000000000001",
    agency: "0a000000-0a00-4a00-aa00-000000000001",
    service: "05000000-0500-4500-a500-000000000001",
    queue: "0f000000-0f00-4f00-af00-000000000001",
    operation: "09000000-0900-4900-a900-000000000001",
  } as const;

  beforeAll(async () => {
    pg = await startPostgresContainer();
    await applyMigrations(pg);

    await pg.query(
      `INSERT INTO banks (id, name, slug) VALUES ('${IDS.bank}', 'Banque OpTest', 'banque-optest')`
    );
    await pg.query(
      `INSERT INTO agencies (id, bank_id, name) VALUES ('${IDS.agency}', '${IDS.bank}', 'Agence OpTest')`
    );
    await pg.query(
      `INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes)
       VALUES ('${IDS.service}', '${IDS.bank}', '${IDS.agency}', 'OC', 'Opérations courantes', 15)`
    );
    await pg.query(
      `INSERT INTO queues (id, bank_id, agency_id, service_id)
       VALUES ('${IDS.queue}', '${IDS.bank}', '${IDS.agency}', '${IDS.service}')`
    );
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  }, 30_000);

  it("MODEL-DB-A: table operations présente dans information_schema", async () => {
    const result = await pg.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'operations'`
    );
    expect(result.rows).toHaveLength(1);
  });

  it("MODEL-DB-A: insertion d'une opération avec sla_minutes NULL (hérite du service)", async () => {
    await pg.query(
      `INSERT INTO operations (id, bank_id, agency_id, service_id, code, name)
       VALUES ('${IDS.operation}', '${IDS.bank}', '${IDS.agency}', '${IDS.service}', 'OCDEP', 'Dépôt')`
    );
    const result = await pg.query(
      `SELECT sla_minutes, is_active, display_order FROM operations WHERE id = '${IDS.operation}'`
    );
    expect(result.rows[0]?.sla_minutes, "sla_minutes NULL par défaut").toBeNull();
    expect(result.rows[0]?.is_active).toBe(true);
    expect(Number(result.rows[0]?.display_order)).toBe(0);
  });

  it("MODEL-DB-A: code hors format ^[A-Z0-9]{2,6}$ rejeté par le CHECK", async () => {
    await expect(
      pg.query(
        `INSERT INTO operations (bank_id, agency_id, service_id, code, name)
         VALUES ('${IDS.bank}', '${IDS.agency}', '${IDS.service}', 'oc-lower', 'Bad')`
      )
    ).rejects.toThrow();
  });

  it("MODEL-DB-A: sla_minutes = 0 rejeté par le CHECK (≥1 si non-null)", async () => {
    await expect(
      pg.query(
        `INSERT INTO operations (bank_id, agency_id, service_id, code, name, sla_minutes)
         VALUES ('${IDS.bank}', '${IDS.agency}', '${IDS.service}', 'OCZ', 'ZeroSla', 0)`
      )
    ).rejects.toThrow();
  });

  it("MODEL-DB-A: unicité (service_id, code) — doublon rejeté", async () => {
    await expect(
      pg.query(
        `INSERT INTO operations (bank_id, agency_id, service_id, code, name)
         VALUES ('${IDS.bank}', '${IDS.agency}', '${IDS.service}', 'OCDEP', 'Dépôt bis')`
      )
    ).rejects.toThrow();
  });

  it("MODEL-DB-A: tickets.operation_id accepte une opération et est NULLABLE", async () => {
    // Ticket sans operation_id (NULL — rétrocompat F2/F3)
    await pg.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, channel, status, tracking_id, issued_at)
       VALUES ('${IDS.bank}', '${IDS.agency}', '${IDS.queue}', '${IDS.service}',
               1, 'KIOSK', 'WAITING', 'optesttrk0000000001', now())`
    );
    // Ticket avec operation_id
    await pg.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, operation_id, number, channel, status, tracking_id, issued_at)
       VALUES ('${IDS.bank}', '${IDS.agency}', '${IDS.queue}', '${IDS.service}', '${IDS.operation}',
               2, 'KIOSK', 'WAITING', 'optesttrk0000000002', now())`
    );
    const withOp = await pg.query(
      `SELECT operation_id FROM tickets WHERE tracking_id = 'optesttrk0000000002'`
    );
    const withoutOp = await pg.query(
      `SELECT operation_id FROM tickets WHERE tracking_id = 'optesttrk0000000001'`
    );
    expect(withOp.rows[0]?.operation_id).toBe(IDS.operation);
    expect(withoutOp.rows[0]?.operation_id).toBeNull();
  });

  it("MODEL-DB-A: FK operation_id en RESTRICT — suppression d'une opération référencée rejetée", async () => {
    await expect(
      pg.query(`DELETE FROM operations WHERE id = '${IDS.operation}'`)
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. RLS + tenant-isolation (D8 — FORCE RLS prouvée cross-bank)
// ─────────────────────────────────────────────────────────────────────────────

describe("MODEL-DB-A: operations — RLS FORCE + tenant-isolation cross-bank (Testcontainers)", () => {
  let harness: DualConnectionHarness;

  const bankA = "aaaaaaaa-0000-4000-8000-0000000000a1";
  const bankB = "bbbbbbbb-0000-4000-8000-0000000000b2";
  const agencyA = "aa000000-0000-4000-8000-0000000000a1";
  const agencyB = "bb000000-0000-4000-8000-0000000000b2";
  const serviceA = "a5000000-0000-4000-8000-0000000000a1";
  const serviceB = "b5000000-0000-4000-8000-0000000000b2";
  const operationA = "a9000000-0000-4000-8000-0000000000a1";
  const operationB = "b9000000-0000-4000-8000-0000000000b2";

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);

    await harness.query(`INSERT INTO banks (id, name, slug) VALUES
      ('${bankA}', 'Banque A', 'op-banque-a'),
      ('${bankB}', 'Banque B', 'op-banque-b')`);
    await harness.query(`INSERT INTO agencies (id, bank_id, name) VALUES
      ('${agencyA}', '${bankA}', 'Agence A'),
      ('${agencyB}', '${bankB}', 'Agence B')`);
    await harness.query(`INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes) VALUES
      ('${serviceA}', '${bankA}', '${agencyA}', 'OC', 'Serv A', 15),
      ('${serviceB}', '${bankB}', '${agencyB}', 'OC', 'Serv B', 15)`);
    await harness.query(`INSERT INTO operations (id, bank_id, agency_id, service_id, code, name) VALUES
      ('${operationA}', '${bankA}', '${agencyA}', '${serviceA}', 'OCA', 'Op A'),
      ('${operationB}', '${bankB}', '${agencyB}', '${serviceB}', 'OCB', 'Op B')`);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it("MODEL-DB-A: operations — RLS ENABLED + FORCED + policy tenant_isolation (information_schema)", async () => {
    const rls = await harness.query(`
      SELECT pt.rowsecurity, pc.relforcerowsecurity AS forcerowsecurity
      FROM pg_tables pt
      JOIN pg_class pc ON pc.relname = pt.tablename
        AND pc.relnamespace = 'public'::regnamespace
      WHERE pt.schemaname = 'public' AND pt.tablename = 'operations'
    `);
    expect(rls.rows[0]?.rowsecurity, "RLS ENABLED").toBe(true);
    expect(rls.rows[0]?.forcerowsecurity, "FORCE RLS").toBe(true);

    const policy = await harness.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'operations'
        AND policyname = 'tenant_isolation'
    `);
    expect(policy.rows).toHaveLength(1);
  });

  it("MODEL-DB-A: sigfa_app a GRANT SELECT/INSERT/UPDATE/DELETE sur operations", async () => {
    const grants = await harness.query(`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'operations' AND grantee = 'sigfa_app'
      ORDER BY privilege_type
    `);
    const privs = grants.rows.map((r) => String(r.privilege_type));
    for (const expected of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(privs, `GRANT ${expected} manquant`).toContain(expected);
    }
  });

  it("MODEL-DB-A: contexte A → zéro opération de B (tenant-isolation cross-bank)", async () => {
    await assertTenantIsolated(
      harness,
      "operations",
      { id: operationA, bank_id: bankA, agency_id: agencyA, service_id: serviceA, code: "OCA", name: "Op A" },
      { id: operationB, bank_id: bankB, agency_id: agencyB, service_id: serviceB, code: "OCB", name: "Op B" },
      bankA,
      bankB
    );
  });

  it("MODEL-DB-A: injection bank_id=B dans un INSERT operations sous contexte A → rejet WITH CHECK", async () => {
    await expect(
      withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
        return query(
          `INSERT INTO operations (bank_id, agency_id, service_id, code, name)
           VALUES ('${bankB}', '${agencyB}', '${serviceB}', 'INJ', 'Injection') RETURNING id`
        );
      })
    ).rejects.toThrow();
  });

  it("MODEL-DB-A: sans app.current_bank_id → zéro opération visible (FORCE RLS)", async () => {
    const result = await harness.appQuery("SELECT * FROM operations");
    expect(result.rows).toHaveLength(0);
  });
});
