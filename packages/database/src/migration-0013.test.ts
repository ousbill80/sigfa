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
 * DB-AI-FEATURES — Migration 0013 : table ai_features (couture IA-001).
 *
 * Prouve, sur PostgreSQL 16 réelle (Testcontainers — LA LOI T5) :
 *   - up : table ai_features présente, colonnes du FeatureRecord IA-001 ;
 *   - up : clé unique (bank,agency,service,date,hour_bucket,feature_set_version)
 *     NULLS NOT DISTINCT — upsert idempotent, service_id NULL = clé unique ;
 *   - up : RLS ENABLE + FORCE + policy tenant_isolation, GRANT sigfa_app ;
 *   - up : purge rétention (computed_at) supprime le vieux, garde le récent ;
 *   - down : table retirée ;
 *   - idempotence : up réapplicable après down.
 *
 * Nommés `DB-0013: ...`.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Exécute un fichier de migration (.sql ou .down.sql) statement par statement. */
async function runMigrationFile(harness: PostgresHarness, fileName: string): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, fileName), "utf8");
  for (const statement of splitStatements(sql)) {
    await harness.query(statement);
  }
}

/** Applique toutes les migrations STRICTEMENT antérieures à 0013 (base "avant"). */
async function applyMigrationsBefore0013(harness: PostgresHarness): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .filter((name) => name < "0013")
    .sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    await runMigrationFile(harness, file);
  }
}

/** Existence d'une table publique. */
async function tableExists(pg: PostgresHarness, table: string): Promise<boolean> {
  const rows = await pg.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '${table}'`
  );
  return rows.rows.length > 0;
}

describe("DB-0013: migration 0013 — ai_features (couture IA-001)", () => {
  let pg: PostgresHarness;

  const IDS = {
    bank: "b0130000-b013-4b0b-ab0b-b0b0b0b0b0b0",
    agency: "a0130000-a013-4a0a-aa0a-a0a0a0a0a0a0",
  } as const;

  /** Colonnes attendues du FeatureRecord IA-001. */
  const FEATURE_COLUMNS = [
    "bank_id",
    "agency_id",
    "service_id",
    "date",
    "hour_bucket",
    "bucket_minutes",
    "arrivals",
    "served",
    "no_show",
    "abandoned",
    "avg_wait_seconds",
    "p90_wait_seconds",
    "avg_service_seconds",
    "counters_open",
    "agents_active",
    "day_of_week",
    "is_month_end",
    "is_public_pay_day",
    "is_public_holiday",
    "is_eve_of_holiday",
    "factors",
    "arrivals_lag_1d",
    "arrivals_lag_7d",
    "arrivals_roll_mean_4w",
    "is_partial",
    "available_days",
    "feature_set_version",
    "computed_at",
  ] as const;

  /** Colonnes NON-clé (arguments d'un INSERT/upsert minimal). */
  const REQUIRED_INSERT = `
    "bank_id", "agency_id", "service_id", "date", "hour_bucket", "bucket_minutes",
    "arrivals", "served", "no_show", "abandoned", "p90_wait_seconds",
    "counters_open", "agents_active", "day_of_week",
    "is_month_end", "is_public_pay_day", "is_public_holiday", "is_eve_of_holiday",
    "is_partial", "available_days", "feature_set_version"`;

  /** Fragments (colonnes/valeurs) d'un INSERT ai_features. */
  interface InsertFragments {
    readonly cols: string;
    readonly vals: string;
  }

  /** Valeurs d'un enregistrement complet — service_id passé à part. */
  function features(
    serviceId: string | null,
    arrivals: number,
    computedAt?: string
  ): InsertFragments {
    const svc = serviceId === null ? "NULL" : `'${serviceId}'`;
    const computed = computedAt ? `, "computed_at"` : "";
    const computedVal = computedAt ? `, '${computedAt}'` : "";
    return {
      cols: `(${REQUIRED_INSERT}${computed})`,
      vals: `('${IDS.bank}', '${IDS.agency}', ${svc}, '2026-07-10', 9, 60, ${arrivals}, ${arrivals}, 0, 0, 120.0, 3, 2, 5, false, false, false, false, false, 90, 'fs-v1'${computedVal})`,
    };
  }

  beforeAll(async () => {
    pg = await startPostgresContainer();
    await applyMigrationsBefore0013(pg);

    await pg.query(
      `INSERT INTO banks (id, name, slug) VALUES ('${IDS.bank}', 'Banque 0013', 'banque-0013')`
    );
    await pg.query(
      `INSERT INTO agencies (id, bank_id, name) VALUES ('${IDS.agency}', '${IDS.bank}', 'Agence 0013')`
    );
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  }, 30_000);

  it("DB-0013: .down.sql présent pour 0013", () => {
    const files = readdirSync(MIGRATIONS_DIR);
    expect(files).toContain("0013_ai_features.sql");
    expect(files).toContain("0013_ai_features.down.sql");
  });

  it("DB-0013: up — table ai_features présente avec toutes les colonnes IA-001", async () => {
    await runMigrationFile(pg, "0013_ai_features.sql");
    expect(await tableExists(pg, "ai_features"), "table ai_features").toBe(true);

    const cols = await pg.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ai_features'`
    );
    const names = cols.rows.map((r) => r.column_name as string);
    for (const c of FEATURE_COLUMNS) {
      expect(names, `colonne ${c}`).toContain(c);
    }
  });

  it("DB-0013: up — upsert idempotent (service_id renseigné) via clé unique", async () => {
    const v = features("svc-1", 10);
    await pg.query(`INSERT INTO ai_features ${v.cols} VALUES ${v.vals}`);
    // Rejouer la même clé avec ON CONFLICT DO NOTHING → aucune ligne insérée.
    const dup = await pg.query(
      `INSERT INTO ai_features ${v.cols} VALUES ${v.vals}
       ON CONFLICT (bank_id, agency_id, service_id, date, hour_bucket, feature_set_version)
       DO NOTHING RETURNING id`
    );
    expect(dup.rows).toHaveLength(0);

    const count = await pg.query(
      `SELECT count(*)::int AS n FROM ai_features
        WHERE bank_id = '${IDS.bank}' AND service_id = 'svc-1'`
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it("DB-0013: up — NULLS NOT DISTINCT : service_id NULL est une clé canonique unique", async () => {
    const v = features(null, 7);
    await pg.query(`INSERT INTO ai_features ${v.cols} VALUES ${v.vals}`);
    // Second insert même clé (service_id NULL) → conflit (NULLS NOT DISTINCT).
    const dup = await pg.query(
      `INSERT INTO ai_features ${v.cols} VALUES ${v.vals}
       ON CONFLICT (bank_id, agency_id, service_id, date, hour_bucket, feature_set_version)
       DO NOTHING RETURNING id`
    );
    expect(dup.rows, "service_id NULL doit être unique (NULLS NOT DISTINCT)").toHaveLength(0);
  });

  it("DB-0013: up — RLS ENABLE + FORCE + policy tenant_isolation + GRANT sigfa_app", async () => {
    const rls = await pg.query(`
      SELECT pt.rowsecurity, pc.relforcerowsecurity AS force
      FROM pg_tables pt
      JOIN pg_class pc ON pc.relname = pt.tablename AND pc.relnamespace = 'public'::regnamespace
      WHERE pt.schemaname = 'public' AND pt.tablename = 'ai_features'
    `);
    expect(rls.rows).toHaveLength(1);
    expect(rls.rows[0]?.rowsecurity, "RLS ENABLE").toBe(true);
    expect(rls.rows[0]?.force, "RLS FORCE").toBe(true);

    const policies = await pg.query(`
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'ai_features' AND policyname = 'tenant_isolation'
    `);
    expect(policies.rows, "policy tenant_isolation").toHaveLength(1);

    const grants = await pg.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'ai_features' AND grantee = 'sigfa_app'`
    );
    const privs = grants.rows.map((r) => r.privilege_type as string);
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(privs, `GRANT ${p}`).toContain(p);
    }
  });

  it("DB-0013: up — rétention 24 mois : DELETE computed_at ancien, garde récent", async () => {
    // Une feature ancienne (>24 mois) et une récente sur une autre clé.
    const old = features("svc-old", 3, "2020-01-01T00:00:00Z");
    await pg.query(`INSERT INTO ai_features ${old.cols} VALUES ${old.vals}`);

    const cutoff = `'2026-07-13T00:00:00Z'::timestamptz - interval '24 months'`;
    const del = await pg.query(
      `WITH d AS (DELETE FROM ai_features WHERE computed_at < ${cutoff} RETURNING id)
       SELECT count(*)::int AS n FROM d`
    );
    expect(Number(del.rows[0]?.n), "ancien supprimé").toBeGreaterThanOrEqual(1);

    const remaining = await pg.query(
      `SELECT count(*)::int AS n FROM ai_features WHERE service_id = 'svc-1'`
    );
    expect(Number(remaining.rows[0]?.n), "récent conservé").toBe(1);
  });

  it("DB-0013: down — table ai_features retirée", async () => {
    await runMigrationFile(pg, "0013_ai_features.down.sql");
    expect(await tableExists(pg, "ai_features"), "table supprimée").toBe(false);
  });

  it("DB-0013: up réapplicable après down (rollback réversible)", async () => {
    await runMigrationFile(pg, "0013_ai_features.sql");
    expect(await tableExists(pg, "ai_features"), "ai_features recréée").toBe(true);
    // La clé unique NULLS NOT DISTINCT est de nouveau opérationnelle.
    const v = features(null, 4);
    await pg.query(`INSERT INTO ai_features ${v.cols} VALUES ${v.vals}`);
    const dup = await pg.query(
      `INSERT INTO ai_features ${v.cols} VALUES ${v.vals}
       ON CONFLICT (bank_id, agency_id, service_id, date, hour_bucket, feature_set_version)
       DO NOTHING RETURNING id`
    );
    expect(dup.rows).toHaveLength(0);
  });
});
