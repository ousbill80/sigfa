/**
 * Tests pour `startPostgresContainerWithRoles` et `assertTenantIsolated` — DB-002
 *
 * Vérifie que le harness double-rôle et l'utilitaire d'isolation fonctionnent
 * correctement sur une PG réelle (Testcontainers).
 *
 * @module
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPostgresContainerWithRoles } from "./harness.js";
import { assertTenantIsolated } from "./assert.js";
import type { DualConnectionHarness } from "./harness.js";

describe("DB-002: harness double-rôle + assertTenantIsolated", () => {
  let harness: DualConnectionHarness;

  const bankA = "aaaaaaaa-1111-4000-8000-000000000001";
  const bankB = "bbbbbbbb-1111-4000-8000-000000000002";

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();

    // Créer une table de test avec bank_id + RLS
    await harness.query(`
      CREATE TABLE IF NOT EXISTS test_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bank_id uuid NOT NULL,
        name text NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `);

    // Activer RLS avec nullif pour gérer l'absence de contexte
    await harness.query(`ALTER TABLE test_items ENABLE ROW LEVEL SECURITY`);
    await harness.query(`ALTER TABLE test_items FORCE ROW LEVEL SECURITY`);
    await harness.query(`
      DROP POLICY IF EXISTS tenant_isolation ON test_items
    `);
    await harness.query(`
      CREATE POLICY tenant_isolation ON test_items
        USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
        WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
    `);

    // Accorder CRUD à sigfa_app
    await harness.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON test_items TO sigfa_app`);

    // Insérer des fixtures (via connexion migrateur = BYPASSRLS)
    await harness.query(`
      INSERT INTO test_items (id, bank_id, name) VALUES
        ('aaaaaaaa-2222-4000-8000-000000000001', '${bankA}', 'Item A'),
        ('bbbbbbbb-2222-4000-8000-000000000002', '${bankB}', 'Item B')
      ON CONFLICT (id) DO NOTHING
    `);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it(
    "DB-002: startPostgresContainerWithRoles expose migrationConnectionString et appConnectionString distincts",
    async () => {
      expect(harness.migrationConnectionString).toBeDefined();
      expect(harness.appConnectionString).toBeDefined();
      expect(harness.migrationConnectionString).not.toBe(harness.appConnectionString);
      expect(harness.appConnectionString).toContain("sigfa_app");
    },
    30_000
  );

  it(
    "DB-002: sigfa_app n'a pas BYPASSRLS (pg_roles)",
    async () => {
      const result = await harness.query(
        `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'sigfa_app'`
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.rolbypassrls).toBe(false);
    },
    30_000
  );

  it(
    "DB-002: appQuery sans contexte → 0 lignes (FORCE RLS)",
    async () => {
      const result = await harness.appQuery("SELECT * FROM test_items");
      expect(result.rows).toHaveLength(0);
    },
    30_000
  );

  it(
    "DB-002: appQuery avec contexte A → 1 ligne de A, 0 ligne de B",
    async () => {
      await harness.appQuery("BEGIN");
      await harness.appQuery(`SET LOCAL app.current_bank_id = '${bankA}'`);
      const result = await harness.appQuery("SELECT bank_id FROM test_items");
      await harness.appQuery("COMMIT");

      expect(result.rows).toHaveLength(1);
      expect((result.rows[0] as { bank_id: string }).bank_id).toBe(bankA);
    },
    30_000
  );

  it(
    "DB-002: assertTenantIsolated passe sur test_items (table RLS active)",
    async () => {
      await expect(
        assertTenantIsolated(
          harness,
          "test_items",
          { id: "aaaaaaaa-2222-4000-8000-000000000001", bank_id: bankA, name: "Item A" },
          { id: "bbbbbbbb-2222-4000-8000-000000000002", bank_id: bankB, name: "Item B" },
          bankA,
          bankB
        )
      ).resolves.toBeUndefined();
    },
    60_000
  );
});
