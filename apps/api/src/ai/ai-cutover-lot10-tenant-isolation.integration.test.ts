/**
 * Test d'ISOLATION TENANT — SEC-002-CUTOVER-LOT10 + F10-FEATURE-STORE.
 *
 * Prouve, sur PostgreSQL 16 réelle sous connexion `sigfa_app` NOBYPASSRLS (jamais
 * l'owner qui contourne FORCE RLS), que le feature-store DB-backed (`DbFeatureStore`
 * sur `ai_features`, lecture ARMÉE via `withArmedTenant`) isole réellement les
 * tenants — c'est le chemin de production du provider de `GET /ai/forecast` :
 *
 *   - le SQL EXACT de `DbFeatureStore.getByAgency` (SELECT … WHERE bank_id AND
 *     agency_id) rejoué armé sur B, en CIBLANT bank_id/agency_id=A, renvoie 0 ligne ;
 *   - A armé LIT bien SES features ; le forecast de A ne voit QUE les `ai_features`
 *     de A, B est inatteignable.
 *   - l'UPSERT de `DbFeatureStore.upsertMany` sous armement B ne peut PAS écrire une
 *     ligne portant bank_id=A (WITH CHECK de la policy → erreur RLS).
 *
 * COUTURE DB COMPLÈTE : `ai_features` (migration 0013) porte `tenant_isolation` FORCE
 * RLS + GRANT SELECT/INSERT/UPDATE/DELETE `sigfa_app`. Le SQL exécuté ici est CELUI du
 * store câblé, rejoué à travers `withArmedTenant` — l'exact chemin de production.
 *
 * PREUVE ROUGE (armement load-bearing) : SANS armer `app.current_bank_id`, la même
 * connexion `sigfa_app` voit ZÉRO ligne (FORCE RLS) — c'est bien l'armement, pas le
 * `WHERE bank_id` applicatif, qui porte l'isolation en défense-en-profondeur.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startPostgresContainerWithRoles,
  type DualConnectionHarness,
} from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "@sigfa/database/test-support";
import { withArmedTenant, type ArmableConnection } from "src/lib/armed-tenant.js";
import {
  DbFeatureStore,
  asFeatureStoreQuery,
} from "src/ai/db-feature-store.js";
import { computeFeatureSet, type RawBucketObservation } from "src/ai/feature-engine.js";

let h: DualConnectionHarness;

const bankA = "aaaaaaaa-0000-4000-8000-00000000f0a0";
const bankB = "bbbbbbbb-0000-4000-8000-00000000f0b0";
const agencyA = "aa000000-0000-4000-8000-00000000f0a0";
const agencyB = "bb000000-0000-4000-8000-00000000f0b0";

const FROZEN_NOW = new Date("2027-01-01T00:00:00Z");

/** Adapte `appQuery` (connexion sigfa_app NOBYPASSRLS) en `ArmableConnection`. */
function armable(harness: DualConnectionHarness): ArmableConnection {
  return {
    query: async (sql: string, values?: unknown[]) => {
      const res =
        values !== undefined
          ? await harness.appQuery(sql, values)
          : await harness.appQuery(sql);
      return { rows: res.rows };
    },
  };
}

/** Observation brute minimale d'un bucket, pour une banque/agence/jour. */
function obs(bankId: string, agencyId: string, date: string, hourBucket: number): RawBucketObservation {
  return {
    bankId,
    agencyId,
    serviceId: null,
    date,
    hourBucket,
    bucketMinutes: 60,
    arrivals: 10,
    served: 9,
    noShow: 1,
    abandoned: 0,
    totalWaitSeconds: 270,
    p90WaitSeconds: 120,
    totalServiceSeconds: 540,
    countersOpen: 2,
    agentsActive: 2,
    isPartialSource: false,
  };
}

beforeAll(async () => {
  h = await startPostgresContainerWithRoles();
  await applyMigrations(h);
  // Seed via le rôle migrateur (owner) : deux tenants disjoints A et B.
  await h.query(
    `INSERT INTO banks (id, name, slug) VALUES
       ('${bankA}','Banque A','cutover10-a'),
       ('${bankB}','Banque B','cutover10-b') ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO agencies (id, bank_id, name, weekly_schedule) VALUES
       ('${agencyA}','${bankA}','Agence A','{}'),
       ('${agencyB}','${bankB}','Agence B','{}') ON CONFLICT (id) DO NOTHING`
  );

  // Matérialise via le STORE DB, chacun ARMÉ sur SA banque (chemin de production).
  const featuresA = computeFeatureSet([obs(bankA, agencyA, "2026-06-10", 9)], {
    holidays: new Set(),
    now: FROZEN_NOW,
  });
  const featuresB = computeFeatureSet([obs(bankB, agencyB, "2026-06-10", 9)], {
    holidays: new Set(),
    now: FROZEN_NOW,
  });
  await withArmedTenant(armable(h), bankA, (conn) =>
    new DbFeatureStore(asFeatureStoreQuery(conn)).upsertMany(featuresA)
  );
  await withArmedTenant(armable(h), bankB, (conn) =>
    new DbFeatureStore(asFeatureStoreQuery(conn)).upsertMany(featuresB)
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

describe("SEC-002-CUTOVER-LOT10 + F10: isolation tenant sous armement (ai_features / forecast)", () => {
  // ── PREUVE ROUGE : l'armement est load-bearing ──────────────────────────────
  it("SEC-002-CUTOVER-LOT10: SANS armement, sigfa_app voit ZÉRO ligne ai_features (FORCE RLS)", async () => {
    const rows = await h.appQuery(`SELECT id FROM ai_features`);
    expect(rows.rows).toHaveLength(0);
  }, 60_000);

  // ── DbFeatureStore.getByAgency (SELECT ai_features WHERE bank_id AND agency_id) ──
  it("SEC-002-CUTOVER-LOT10: forecast — B armé ne LIT PAS les ai_features de A (getByAgency isolé)", async () => {
    // SQL EXACT du store rejoué armé sur B en ciblant bank_id/agency_id=A → 0 ligne.
    const seenByB = await withArmedTenant(armable(h), bankB, (conn) =>
      new DbFeatureStore(asFeatureStoreQuery(conn)).getByAgency(bankA, agencyA)
    );
    expect(seenByB).toHaveLength(0);

    // A armé VOIT bien SES features (une seule ligne matérialisée).
    const seenByA = await withArmedTenant(armable(h), bankA, (conn) =>
      new DbFeatureStore(asFeatureStoreQuery(conn)).getByAgency(bankA, agencyA)
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]?.bankId).toBe(bankA);
    expect(seenByA[0]?.agencyId).toBe(agencyA);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT10: getByBank — B armé ne compte QUE ses propres features (jamais celles de A)", async () => {
    const countByB = await withArmedTenant(armable(h), bankB, (conn) =>
      new DbFeatureStore(asFeatureStoreQuery(conn)).count(bankB)
    );
    const countByA = await withArmedTenant(armable(h), bankA, (conn) =>
      new DbFeatureStore(asFeatureStoreQuery(conn)).count(bankA)
    );
    expect(countByB).toBe(1);
    expect(countByA).toBe(1);
    // B ciblant bank_id=A ne voit rien (la RLS borne à B, pas le WHERE applicatif).
    const bTargetingA = await withArmedTenant(armable(h), bankB, (conn) =>
      new DbFeatureStore(asFeatureStoreQuery(conn)).count(bankA)
    );
    expect(bTargetingA).toBe(0);
  }, 60_000);

  // ── DbFeatureStore.upsertMany (WITH CHECK de la policy borne l'écriture) ─────
  it("SEC-002-CUTOVER-LOT10: upsert — B armé NE PEUT PAS écrire une ligne portant bank_id=A (WITH CHECK RLS)", async () => {
    const featureOfA = computeFeatureSet([obs(bankA, agencyA, "2026-06-11", 10)], {
      holidays: new Set(),
      now: FROZEN_NOW,
    });
    await expect(
      withArmedTenant(armable(h), bankB, (conn) =>
        new DbFeatureStore(asFeatureStoreQuery(conn)).upsertMany(featureOfA)
      )
    ).rejects.toThrow();
    // La ligne interdite n'existe pas (vérifié armé sur A).
    const rowsOfA = await withArmedTenant(armable(h), bankA, (conn) =>
      new DbFeatureStore(asFeatureStoreQuery(conn)).getByAgency(bankA, agencyA)
    );
    expect(rowsOfA.some((r) => r.date === "2026-06-11")).toBe(false);
  }, 60_000);

  it("SEC-002-CUTOVER-LOT10: upsert idempotent sous armement — rejouer la même fenêtre ne crée pas de doublon", async () => {
    const features = computeFeatureSet([obs(bankA, agencyA, "2026-06-12", 11)], {
      holidays: new Set(),
      now: FROZEN_NOW,
    });
    await withArmedTenant(armable(h), bankA, (conn) =>
      new DbFeatureStore(asFeatureStoreQuery(conn)).upsertMany(features)
    );
    await withArmedTenant(armable(h), bankA, (conn) =>
      new DbFeatureStore(asFeatureStoreQuery(conn)).upsertMany(features)
    );
    const rows = await withArmedTenant(armable(h), bankA, (conn) =>
      new DbFeatureStore(asFeatureStoreQuery(conn)).getByAgency(bankA, agencyA)
    );
    expect(rows.filter((r) => r.date === "2026-06-12")).toHaveLength(1);
  }, 60_000);
});
