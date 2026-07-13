import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startPostgresContainerWithRoles } from "@sigfa/testing/tenant-isolation";
import type { DualConnectionHarness } from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "./test-support/migrate.js";
import { withTenant } from "./tenant.js";

/**
 * DB-THRESHOLDS-TENANT-GRANT — Migration 0014 : couture SEC-002.
 *
 * La route `PATCH /banks/:id/thresholds` (apps/api) fait un UPDATE des 3 seuils
 * opérationnels sur `banks`. Sous connexion RLS armée (rôle `sigfa_app`,
 * NOBYPASSRLS), l'UPDATE échouait avec `permission denied for table banks`
 * (0001_rls.sql révoque INSERT/UPDATE/DELETE sur banks pour sigfa_app).
 *
 * Cette migration accorde le MINIMUM tenant-scopé :
 *   1. GRANT UPDATE colonne-scopé (3 seuils UNIQUEMENT) ;
 *   2. policy RLS UPDATE tenant-scopée (id = app.current_bank_id, USING+WITH CHECK).
 *
 * Prouve, sur PostgreSQL 16 réelle (Testcontainers — LA LOI T5), rôle sigfa_app
 * NOBYPASSRLS, connexion armée via `SET LOCAL app.current_bank_id` :
 *   - ✅ tenant A PEUT mettre à jour SES 3 seuils sur SA ligne banks ;
 *   - ❌ tenant A ne peut PAS mettre à jour la ligne banks du tenant B (RLS → 0 ligne) ;
 *   - ❌ UPDATE d'une AUTRE colonne (name, is_active…) → permission denied (GRANT colonne) ;
 *   - ❌ INSERT/DELETE sur banks restent refusés (inchangés) ;
 *   - la policy SELECT tenant_isolation existante est préservée.
 *
 * Nommés `DB-0014: ...`.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

describe("DB-0014: migration 0014 — GRANT UPDATE seuils tenant-scopé sur banks (couture SEC-002)", () => {
  let harness: DualConnectionHarness;

  const bankA = "aaaaaaaa-0014-4000-8000-000000000001";
  const bankB = "bbbbbbbb-0014-4000-8000-000000000002";

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);

    // Insertion des tenants via connexion migrateur (BYPASSRLS).
    await harness.query(
      `INSERT INTO banks (id, name, slug)
       VALUES ($1, 'Banque A DB-0014', 'banque-a-db0014'),
              ($2, 'Banque B DB-0014', 'banque-b-db0014')
       ON CONFLICT (id) DO NOTHING`,
      [bankA, bankB]
    );
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it(
    "DB-0014: la migration 0014 existe dans migrations/ (fichier up présent)",
    () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith("0014"));
      expect(files.some((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))).toBe(true);
    }
  );

  it(
    "DB-0014: tenant A PEUT mettre à jour SES 3 seuils sur SA ligne banks (connexion armée)",
    async () => {
      const rows = await withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
        const r = await query(
          `UPDATE banks
             SET queue_critical_threshold = 123,
                 agent_inactivity_minutes = 42,
                 no_show_timeout_minutes = 7
           WHERE id = '${bankA}'
           RETURNING queue_critical_threshold, agent_inactivity_minutes, no_show_timeout_minutes`
        );
        return r.rows as Array<Record<string, number>>;
      });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.queue_critical_threshold)).toBe(123);
      expect(Number(rows[0]!.agent_inactivity_minutes)).toBe(42);
      expect(Number(rows[0]!.no_show_timeout_minutes)).toBe(7);
    },
    30_000
  );

  it(
    "DB-0014: tenant A ne peut PAS modifier les seuils de la ligne banks du tenant B (RLS → 0 ligne)",
    async () => {
      const rows = await withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
        const r = await query(
          `UPDATE banks
             SET queue_critical_threshold = 999
           WHERE id = '${bankB}'
           RETURNING id`
        );
        return r.rows;
      });
      // RLS filtre la ligne B hors du contexte tenant A → 0 ligne affectée.
      expect(rows).toHaveLength(0);

      // Vérification indépendante (migrateur) : la ligne B est intacte.
      const check = await harness.query(
        `SELECT queue_critical_threshold FROM banks WHERE id = $1`,
        [bankB]
      );
      expect(Number(check.rows[0]!.queue_critical_threshold)).toBe(50);
    },
    30_000
  );

  it(
    "DB-0014: UPDATE d'une AUTRE colonne de banks (name) → permission denied (GRANT colonne-scopé)",
    async () => {
      await expect(
        withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
          await query(`UPDATE banks SET name = 'Hack' WHERE id = '${bankA}'`);
        })
      ).rejects.toThrow(/permission denied/i);
      await harness.appQuery("ROLLBACK").catch(() => undefined);
    },
    30_000
  );

  it(
    "DB-0014: UPDATE d'une AUTRE colonne de banks (is_active) → permission denied (GRANT colonne-scopé)",
    async () => {
      await expect(
        withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
          await query(`UPDATE banks SET is_active = false WHERE id = '${bankA}'`);
        })
      ).rejects.toThrow(/permission denied/i);
      await harness.appQuery("ROLLBACK").catch(() => undefined);
    },
    30_000
  );

  it(
    "DB-0014: INSERT banks reste refusé pour sigfa_app (inchangé)",
    async () => {
      await expect(
        withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
          await query(
            `INSERT INTO banks (name, slug) VALUES ('Interdite', 'interdite-db0014')`
          );
        })
      ).rejects.toThrow(/permission denied/i);
      await harness.appQuery("ROLLBACK").catch(() => undefined);
    },
    30_000
  );

  it(
    "DB-0014: DELETE banks reste refusé pour sigfa_app (inchangé)",
    async () => {
      await expect(
        withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
          await query(`DELETE FROM banks WHERE id = '${bankA}'`);
        })
      ).rejects.toThrow(/permission denied/i);
      await harness.appQuery("ROLLBACK").catch(() => undefined);
    },
    30_000
  );

  it(
    "DB-0014: la policy SELECT tenant_isolation sur banks est préservée + policy UPDATE tenant-scopée présente",
    async () => {
      const result = await harness.query(
        `SELECT policyname, cmd, qual, with_check
           FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'banks'`
      );
      const policies = result.rows;

      const selectPolicy = policies.find((p) => String(p.cmd) === "SELECT");
      expect(selectPolicy, "policy SELECT préservée").toBeDefined();
      expect(String(selectPolicy!.policyname)).toBe("tenant_isolation");

      const updatePolicy = policies.find((p) => String(p.cmd) === "UPDATE");
      expect(updatePolicy, "policy UPDATE tenant-scopée présente").toBeDefined();
      // USING et WITH CHECK doivent référencer app.current_bank_id et id.
      expect(String(updatePolicy!.qual)).toMatch(/app\.current_bank_id/);
      expect(String(updatePolicy!.qual)).toMatch(/\bid\b/);
      expect(String(updatePolicy!.with_check)).toMatch(/app\.current_bank_id/);
    },
    30_000
  );

  it(
    "DB-0014: sigfa_app détient UPDATE colonne-scopé sur les 3 seuils (+ updated_at ajouté par 0015)",
    async () => {
      // NB : le harnais applique TOUTES les migrations en cumulé. 0015
      // (DB-THRESHOLDS-GRANT-UPDATEDAT) élargit le GRANT colonne d'UNE colonne
      // (`updated_at`) pour couvrir l'horodatage automatique du PATCH thresholds.
      // L'invariant reste : GRANT colonne-scopé (jamais pleine table) ; name, slug,
      // theme, is_active… restent hors GRANT.
      const result = await harness.query(
        `SELECT column_name
           FROM information_schema.column_privileges
          WHERE table_schema = 'public'
            AND table_name = 'banks'
            AND grantee = 'sigfa_app'
            AND privilege_type = 'UPDATE'
          ORDER BY column_name`
      );
      const cols = result.rows.map((r) => String(r.column_name)).sort();
      expect(cols).toEqual(
        [
          "agent_inactivity_minutes",
          "no_show_timeout_minutes",
          "queue_critical_threshold",
          "updated_at",
        ].sort()
      );
    },
    30_000
  );
});
