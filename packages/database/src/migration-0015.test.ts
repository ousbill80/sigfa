import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startPostgresContainerWithRoles } from "@sigfa/testing/tenant-isolation";
import type { DualConnectionHarness } from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "./test-support/migrate.js";
import { withTenant } from "./tenant.js";

/**
 * DB-THRESHOLDS-GRANT-UPDATEDAT — Migration 0015 : couture finale d'armement RLS.
 *
 * La route `PATCH /banks/:id/thresholds` (apps/api) fait
 *   UPDATE banks SET <3 seuils>, updated_at = NOW() WHERE id = ...
 * 0014 accorde à sigfa_app le GRANT UPDATE colonne-scopé sur les 3 seuils
 * UNIQUEMENT + la policy tenant_update. `updated_at` n'y figurait PAS : sous
 * connexion armée sigfa_app (NOBYPASSRLS), l'UPDATE incluant `updated_at = NOW()`
 * échouait en `permission denied for table banks`. 0015 élargit le GRANT colonne
 * d'UNE colonne (`updated_at`) sans toucher aux policies ni aux révocations.
 *
 * Prouve, sur PostgreSQL 16 réelle (Testcontainers — LA LOI T5), rôle sigfa_app
 * NOBYPASSRLS, connexion armée via `SET LOCAL app.current_bank_id` :
 *   - ✅ tenant A PEUT `UPDATE ... SET <3 seuils>, updated_at = NOW()` sur SA ligne ;
 *   - ❌ le même UPDATE sur la ligne du tenant B → 0 ligne (RLS tenant_update) ;
 *   - ❌ UPDATE d'une AUTRE colonne (name) → permission denied (hors GRANT) ;
 *   - ❌ INSERT/DELETE sur banks restent refusés (inchangés) ;
 *   - le GRANT colonne couvre EXACTEMENT les 3 seuils + updated_at (rien d'autre).
 *
 * Nommés `DB-0015: ...`.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

describe("DB-0015: migration 0015 — GRANT UPDATE (updated_at) tenant-scopé sur banks (couture armement thresholds)", () => {
  let harness: DualConnectionHarness;

  const bankA = "aaaaaaaa-0015-4000-8000-000000000001";
  const bankB = "bbbbbbbb-0015-4000-8000-000000000002";

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);

    // Insertion des tenants via connexion migrateur (BYPASSRLS).
    await harness.query(
      `INSERT INTO banks (id, name, slug)
       VALUES ($1, 'Banque A DB-0015', 'banque-a-db0015'),
              ($2, 'Banque B DB-0015', 'banque-b-db0015')
       ON CONFLICT (id) DO NOTHING`,
      [bankA, bankB]
    );
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  it("DB-0015: la migration 0015 existe dans migrations/ (fichiers up + down présents)", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith("0015"));
    expect(files.some((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))).toBe(true);
    expect(files.some((f) => f.endsWith(".down.sql"))).toBe(true);
  });

  it(
    "DB-0015: tenant A PEUT UPDATE ses 3 seuils + updated_at = NOW() sur SA ligne (connexion armée)",
    async () => {
      const rows = await withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
        const r = await query(
          `UPDATE banks
             SET queue_critical_threshold = 200,
                 agent_inactivity_minutes = 30,
                 no_show_timeout_minutes = 5,
                 updated_at = NOW()
           WHERE id = '${bankA}'
           RETURNING queue_critical_threshold, agent_inactivity_minutes,
                     no_show_timeout_minutes, updated_at`
        );
        return r.rows as Array<Record<string, unknown>>;
      });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.queue_critical_threshold)).toBe(200);
      expect(Number(rows[0]!.agent_inactivity_minutes)).toBe(30);
      expect(Number(rows[0]!.no_show_timeout_minutes)).toBe(5);
      expect(rows[0]!.updated_at).toBeDefined();
    },
    30_000
  );

  it(
    "DB-0015: le même UPDATE (seuils + updated_at) sur la ligne du tenant B → 0 ligne (RLS tenant_update)",
    async () => {
      const rows = await withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
        const r = await query(
          `UPDATE banks
             SET queue_critical_threshold = 400,
                 agent_inactivity_minutes = 10,
                 no_show_timeout_minutes = 9,
                 updated_at = NOW()
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
    "DB-0015: UPDATE d'une AUTRE colonne de banks (name) → permission denied (hors GRANT colonne)",
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
    "DB-0015: INSERT banks reste refusé pour sigfa_app (inchangé)",
    async () => {
      await expect(
        withTenant(harness.appQuery.bind(harness), bankA, async (query) => {
          await query(
            `INSERT INTO banks (name, slug) VALUES ('Interdite', 'interdite-db0015')`
          );
        })
      ).rejects.toThrow(/permission denied/i);
      await harness.appQuery("ROLLBACK").catch(() => undefined);
    },
    30_000
  );

  it(
    "DB-0015: DELETE banks reste refusé pour sigfa_app (inchangé)",
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
    "DB-0015: sigfa_app détient UPDATE EXACTEMENT sur les 3 seuils + updated_at (rien d'autre)",
    async () => {
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

  it(
    "DB-0015: la policy SELECT tenant_isolation et la policy UPDATE tenant_update sont préservées (inchangées)",
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
      expect(updatePolicy, "policy UPDATE tenant_update préservée").toBeDefined();
      expect(String(updatePolicy!.policyname)).toBe("tenant_update");
      expect(String(updatePolicy!.qual)).toMatch(/app\.current_bank_id/);
      expect(String(updatePolicy!.with_check)).toMatch(/app\.current_bank_id/);
    },
    30_000
  );
});
