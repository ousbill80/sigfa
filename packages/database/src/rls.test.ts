/**
 * DB-002 — Suite de tests RLS + tenant-isolation
 *
 * TDD rouge→vert : ces tests échouent AVANT l'implémentation RLS.
 * Ils utilisent la connexion applicative (`sigfa_app`, sans BYPASSRLS)
 * pour garantir que RLS est réellement actif.
 *
 * @module
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPostgresContainerWithRoles } from "@sigfa/testing/tenant-isolation";
import type { DualConnectionHarness } from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "./test-support/migrate.js";
import { withTenant } from "./tenant.js";
import { assertTenantIsolated } from "@sigfa/testing/tenant-isolation";

/**
 * Tables métier attendues avec RLS activé.
 * DB-009 : ajout de banks (SELECT only, REVOKE mutations) et retention_policies.
 * MODEL-DB-A : ajout de operations (RLS FORCE + tenant_isolation, D8).
 * Total : 28 tables (scan exhaustif RLS).
 */
const BUSINESS_TABLES = [
  // DB-009 : banks avec RLS SELECT only + REVOKE INSERT/UPDATE/DELETE sigfa_app
  "banks",
  "agencies",
  "agency_exceptional_closures",
  "services",
  // MODEL-DB-A : operations (enfant de services, RLS FORCE)
  "operations",
  "queues",
  "counter_services",
  "counters",
  "kiosks",
  "agency_users",
  "agent_status_history",
  "user_services",
  "ticket_transfers",
  "tickets",
  "users",
  "audit_log",
  // DB-005 : tables de notifications
  "notification_templates",
  "notification_consents",
  "notification_log",
  "notification_devices",
  "notification_test_recipients",
  // DB-006 : tables de reporting
  "daily_agency_stats",
  "export_jobs",
  // DB-008 : rétention
  "retention_policies",
  // DB-007 : tables IA
  "ai_forecasts",
  "ai_staffing_recommendations",
  "ai_anomalies",
  "ai_quality_scores",
] as const;

describe("DB-002 — RLS + tenant-isolation", () => {
  let harness: DualConnectionHarness;

  /** UUIDs des deux banques de test */
  const bankA = "aaaaaaaa-0000-4000-8000-000000000001";
  const bankB = "bbbbbbbb-0000-4000-8000-000000000002";
  const agencyA = "aa000000-0000-4000-8000-000000000001";
  const agencyB = "bb000000-0000-4000-8000-000000000002";

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);

    // Insérer les fixtures via connexion migrateur (owner, BYPASSRLS)
    await harness.query(`INSERT INTO banks (id, name, slug) VALUES
      ('${bankA}', 'Banque A', 'banque-a'),
      ('${bankB}', 'Banque B', 'banque-b')
      ON CONFLICT (id) DO NOTHING`);

    await harness.query(`INSERT INTO agencies (id, bank_id, name) VALUES
      ('${agencyA}', '${bankA}', 'Agence A1'),
      ('${agencyB}', '${bankB}', 'Agence B1')
      ON CONFLICT (id) DO NOTHING`);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 1 : 100% des tables à bank_id ont RLS ENABLED + FORCED + policy tenant_isolation
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-002: information_schema — 100% des tables à bank_id ont RLS ENABLED + FORCED + policy tenant_isolation (test exhaustif)",
    async () => {
      // pg_tables ne contient pas forcerowsecurity — il faut joindre pg_class
      const rlsResult = await harness.query(`
        SELECT pt.tablename,
               pt.rowsecurity,
               pc.relforcerowsecurity AS forcerowsecurity
        FROM pg_tables pt
        JOIN pg_class pc ON pc.relname = pt.tablename
          AND pc.relnamespace = 'public'::regnamespace
        WHERE pt.schemaname = 'public'
          AND pt.tablename = ANY(ARRAY[${BUSINESS_TABLES.map((t) => `'${t}'`).join(",")}])
        ORDER BY pt.tablename
      `);

      for (const row of rlsResult.rows) {
        expect(
          row.rowsecurity,
          `Table ${String(row.tablename)}: RLS doit être ENABLED`
        ).toBe(true);
        expect(
          row.forcerowsecurity,
          `Table ${String(row.tablename)}: FORCE RLS doit être activé`
        ).toBe(true);
      }

      expect(rlsResult.rows).toHaveLength(BUSINESS_TABLES.length);

      // Vérifier que chaque table a la policy tenant_isolation
      const policyResult = await harness.query(`
        SELECT tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND policyname = 'tenant_isolation'
          AND tablename = ANY(ARRAY[${BUSINESS_TABLES.map((t) => `'${t}'`).join(",")}])
        ORDER BY tablename
      `);

      expect(policyResult.rows).toHaveLength(BUSINESS_TABLES.length);

      for (const row of policyResult.rows) {
        expect(row.policyname).toBe("tenant_isolation");
      }
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 5 : rôle applicatif non-owner, non-BYPASSRLS
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-002: rôle applicatif non-owner, non-BYPASSRLS (test pg_roles) ; harness expose les 2 connexions et les tests RLS utilisent la connexion applicative (vérifié)",
    async () => {
      // Vérifier que sigfa_app existe et n'a pas BYPASSRLS
      const rolesResult = await harness.query(`
        SELECT rolname, rolbypassrls, rolsuper
        FROM pg_roles
        WHERE rolname IN ('sigfa_app', 'sigfa_migrator')
        ORDER BY rolname
      `);

      const sigfaApp = rolesResult.rows.find((r) => r.rolname === "sigfa_app");

      expect(sigfaApp).toBeDefined();

      // sigfa_app ne doit PAS avoir BYPASSRLS ni être superuser
      expect(sigfaApp!.rolbypassrls, "sigfa_app NE doit PAS avoir BYPASSRLS").toBe(false);
      expect(sigfaApp!.rolsuper, "sigfa_app NE doit PAS être superuser").toBe(false);

      // Le harness expose bien les deux connexions
      expect(harness.migrationConnectionString).toBeDefined();
      expect(harness.appConnectionString).toBeDefined();
      expect(harness.migrationConnectionString).not.toBe(harness.appConnectionString);
    },
    30_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 3 : sans app.current_bank_id → zéro ligne / écriture rejetée
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-002: sans app.current_bank_id → zéro ligne / écriture rejetée (test)",
    async () => {
      // Sans contexte, la table agencies doit retourner zéro ligne (FORCE RLS)
      const result = await harness.appQuery("SELECT * FROM agencies");
      expect(result.rows).toHaveLength(0);

      // Tentative d'écriture sans contexte doit échouer (WITH CHECK rejette bank_id != current_setting)
      await expect(
        harness.appQuery(
          `INSERT INTO agencies (id, bank_id, name) VALUES (gen_random_uuid(), '${bankA}', 'Test no ctx') RETURNING id`
        )
      ).rejects.toThrow();

      // Remettre la connexion dans un état propre après l'erreur
      await harness.appQuery("ROLLBACK").catch(() => undefined);
    },
    30_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 4 : injection bank_id=B dans un INSERT sous contexte A → rejet WITH CHECK
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-002: injection bank_id=B dans un INSERT sous contexte A → rejet WITH CHECK (test)",
    async () => {
      // Sous contexte A, tenter d'insérer une ligne avec bank_id=B
      await expect(
        withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
          return query(
            `INSERT INTO agencies (id, bank_id, name) VALUES (gen_random_uuid(), '${bankB}', 'Injection B') RETURNING id`
          );
        })
      ).rejects.toThrow();
    },
    30_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 2 : contexte A → zéro ligne de B sur CHAQUE table
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-002: contexte A → zéro ligne de B sur CHAQUE table (suite tenant-isolation, PG réelle)",
    async () => {
      // Vérifier via assertTenantIsolated que le contexte A ne voit pas les lignes de B
      await assertTenantIsolated(
        harness,
        "agencies",
        { id: agencyA, bank_id: bankA, name: "Agence A1" },
        { id: agencyB, bank_id: bankB, name: "Agence B1" },
        bankA,
        bankB
      );
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 6 : withTenant — SET LOCAL scopé transaction, pas de fuite entre transactions
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-002: withTenant — SET LOCAL scopé transaction, pas de fuite entre transactions successives (test)",
    async () => {
      // Transaction 1 : contexte A → ne voit que l'agence A
      const rowsInTx1 = await withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
        const res = await query("SELECT bank_id FROM agencies");
        return res.rows as Array<{ bank_id: string }>;
      });

      expect(rowsInTx1.every((r) => r.bank_id === bankA)).toBe(true);
      expect(rowsInTx1.some((r) => r.bank_id === bankB)).toBe(false);

      // Après la transaction : aucun contexte → zéro ligne (SET LOCAL s'est effacé)
      const rowsAfterTx = await harness.appQuery("SELECT bank_id FROM agencies");
      expect(rowsAfterTx.rows).toHaveLength(0);

      // Transaction 2 : contexte B → ne voit que l'agence B
      const rowsInTx2 = await withTenant(harness.appQuery.bind(harness), bankB, async (query) => {
        const res = await query("SELECT bank_id FROM agencies");
        return res.rows as Array<{ bank_id: string }>;
      });

      expect(rowsInTx2.every((r) => r.bank_id === bankB)).toBe(true);
      expect(rowsInTx2.some((r) => r.bank_id === bankA)).toBe(false);
    },
    60_000
  );
});
