/**
 * Test d'ISOLATION TENANT — SEC-002-CUTOVER-LOT9 (SPLIT tenant/plateforme, reports +
 * onboarding armés ; banks reclassé plateforme).
 *
 * Prouve, sur PostgreSQL 16 réelle, que le SPLIT est CORRECT sur les deux versants :
 *
 *  1. CHEMINS ARMÉS (reports scope=tenant, onboarding) — connexion `sigfa_app`
 *     NOBYPASSRLS + `SET LOCAL app.current_bank_id` (jamais l'owner qui contourne
 *     FORCE RLS) : le SQL EXACT des chemins tenant rejoué armé prouve que B n'atteint
 *     PAS A.
 *       - reports scope=agency/daily/benchmark : `daily_agency_stats` armé sur B ne
 *         voit PAS les agrégats de A (RLS bornée à B) ; A armé voit les SIENS.
 *       - reports export : `export_jobs` armé sur B ne voit/ne réclame PAS le job de A.
 *       - onboarding clone : `services` INSERT marqué bank_id=A REJETÉ (WITH CHECK)
 *         sous armement B ; onboarding kiosk-access : `kiosks` INSERT marqué bank_id=A
 *         REJETÉ sous armement B.
 *
 *  2. CHEMIN PLATEFORME (reports scope=network, buildNetworkResponse) — l'agrégat
 *     CROSS-TENANT réseau lit `daily_agency_stats` SANS filtre `bank_id`. Prouvé que :
 *       - via la connexion PLATEFORME (owner, hors RLS, cf. `withPlatform` en prod),
 *         l'agrégat réseau VOIT TOUTES les banques (A + B) — le réseau reste correct.
 *       - la MÊME requête réseau exécutée sous une connexion ARMÉE (bankId=A) ne verrait
 *         QUE A : c'est précisément pourquoi le chemin réseau NE DOIT PAS être armé
 *         (l'armer casserait l'agrégat). Le split est donc load-bearing.
 *
 * PREUVE ROUGE (armement load-bearing) : SANS armer `app.current_bank_id`, la connexion
 * `sigfa_app` voit ZÉRO ligne (FORCE RLS) — c'est l'armement, pas le `WHERE bank_id`
 * applicatif, qui porte l'isolation en défense-en-profondeur.
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

let h: DualConnectionHarness;

const bankA = "aaaaaaaa-0000-4000-8000-0000000000a9";
const bankB = "bbbbbbbb-0000-4000-8000-0000000000b9";
const agencyA = "aa000000-0000-4000-8000-0000000000a9";
const agencyB = "bb000000-0000-4000-8000-0000000000b9";
const serviceA = "5e000000-0000-4000-8000-0000000000a9";
const jobA = "10b00000-0000-4000-8000-0000000000a9";
const DAY = "2026-07-10";
const PERIOD_START = "2026-07-01";
const PERIOD_END = "2026-07-31";

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

beforeAll(async () => {
  h = await startPostgresContainerWithRoles();
  await applyMigrations(h);
  // Seed via le rôle migrateur (owner) : deux tenants disjoints A et B.
  await h.query(
    `INSERT INTO banks (id, name, slug) VALUES
       ('${bankA}','Banque A','cutover9-a'),
       ('${bankB}','Banque B','cutover9-b') ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO agencies (id, bank_id, name, weekly_schedule) VALUES
       ('${agencyA}','${bankA}','Agence A','{}'),
       ('${agencyB}','${bankB}','Agence B','{}') ON CONFLICT (id) DO NOTHING`
  );
  await h.query(
    `INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes, display_order) VALUES
       ('${serviceA}','${bankA}','${agencyA}','DEP','Dépôt',10,1) ON CONFLICT (id) DO NOTHING`
  );
  // Un agrégat toutes-services (service_id NULL) par banque, MÊME jour/période.
  await h.query(
    `INSERT INTO daily_agency_stats (bank_id, agency_id, service_id, day, tickets_issued)
       VALUES
       ('${bankA}','${agencyA}',NULL,'${DAY}',40),
       ('${bankB}','${agencyB}',NULL,'${DAY}',60)`
  );
  // Un job d'export READY de A (lu par le suivi tenant). `requested_by` NOT NULL.
  await h.query(
    `INSERT INTO export_jobs (id, bank_id, requested_by, scope, period, format, status)
       VALUES ('${jobA}','${bankA}','${agencyA}','agency','2026-07','pdf','READY')
       ON CONFLICT (id) DO NOTHING`
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

describe("SEC-002-CUTOVER-LOT9: split tenant/plateforme (reports + onboarding armés ; banks plateforme)", () => {
  // ── PREUVE ROUGE : l'armement est load-bearing ──────────────────────────────
  it("SEC-002-CUTOVER-LOT9: SANS armement, sigfa_app voit ZÉRO ligne (FORCE RLS) — l'armement porte l'isolation", async () => {
    const stats = await h.appQuery(`SELECT id FROM daily_agency_stats`);
    const jobs = await h.appQuery(`SELECT id FROM export_jobs`);
    const kiosks = await h.appQuery(`SELECT id FROM kiosks`);
    expect(stats.rows).toHaveLength(0);
    expect(jobs.rows).toHaveLength(0);
    expect(kiosks.rows).toHaveLength(0);
  }, 60_000);

  // ── reports scope=agency (lecture armée daily_agency_stats — isolée) ─────────
  it("SEC-002-CUTOVER-LOT9: reports agency — B armé ne voit PAS les agrégats de A (0 ligne) ; A voit les siens", async () => {
    // SQL EXACT de `loadAgencyAggregate` (toutes-services) rejoué armé.
    const sql = `SELECT tickets_issued FROM daily_agency_stats
                  WHERE bank_id = $1 AND agency_id = $2 AND service_id IS NULL
                    AND day >= $3::date AND day <= $4::date`;
    const seenByB = await withArmedTenant(armable(h), bankB, async (conn) =>
      (await conn.query(sql, [bankA, agencyA, DAY, DAY])).rows
    );
    expect(seenByB).toHaveLength(0);
    const seenByA = await withArmedTenant(armable(h), bankA, async (conn) =>
      (await conn.query(sql, [bankA, agencyA, DAY, DAY])).rows
    );
    expect(seenByA).toHaveLength(1);
  }, 60_000);

  // ── reports export (lecture armée export_jobs — ownership isolé) ─────────────
  it("SEC-002-CUTOVER-LOT9: reports export — B armé ne voit PAS le job d'export de A (0 ligne)", async () => {
    // SQL EXACT de `loadOwnedJob` (borne tenant) rejoué armé.
    const sql = `SELECT id FROM export_jobs WHERE id = $1 AND bank_id = $2`;
    const seenByB = await withArmedTenant(armable(h), bankB, async (conn) =>
      (await conn.query(sql, [jobA, bankA])).rows
    );
    expect(seenByB).toHaveLength(0);
    const seenByA = await withArmedTenant(armable(h), bankA, async (conn) =>
      (await conn.query(sql, [jobA, bankA])).rows
    );
    expect(seenByA).toHaveLength(1);
  }, 60_000);

  // ── onboarding clone (INSERT services armé — WITH CHECK cross-tenant) ────────
  it("SEC-002-CUTOVER-LOT9: onboarding clone — B armé ne peut PAS insérer un service marqué bank_id=A (WITH CHECK)", async () => {
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) =>
        conn.query(
          `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes, display_order)
           VALUES ($1, $2, 'X', 'X', 10, 9)`,
          [bankA, agencyA]
        )
      )
    ).rejects.toThrow();
  }, 60_000);

  // ── onboarding kiosk-access (INSERT kiosks armé — WITH CHECK cross-tenant) ───
  it("SEC-002-CUTOVER-LOT9: onboarding kiosk-access — B armé ne peut PAS provisionner une borne marquée bank_id=A (WITH CHECK)", async () => {
    await expect(
      withArmedTenant(armable(h), bankB, async (conn) =>
        conn.query(
          `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash)
           VALUES ($1, $2, 'K', 'hash')`,
          [bankA, agencyA]
        )
      )
    ).rejects.toThrow();
    // B armé provisionne bien SA borne (bank_id=B) sans fuite.
    const ownByB = await withArmedTenant(armable(h), bankB, async (conn) =>
      (
        await conn.query(
          `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash)
           VALUES ($1, $2, 'K', 'hash') RETURNING id`,
          [bankB, agencyB]
        )
      ).rows
    );
    expect(ownByB).toHaveLength(1);
  }, 60_000);

  // ── reports scope=network — CHEMIN PLATEFORME (cross-tenant préservé) ────────
  it("SEC-002-CUTOVER-LOT9: reports network — la connexion PLATEFORME voit TOUTES les banques (A+B) ; armée, elle ne verrait qu'une", async () => {
    // SQL EXACT de `buildNetworkResponse` (agrégat réseau SANS filtre bank_id).
    const networkSql = `SELECT tickets_issued, agency_id
                          FROM daily_agency_stats
                         WHERE service_id IS NULL AND day >= $1::date AND day <= $2::date`;
    // PLATEFORME (owner, hors RLS — cf. withPlatform en prod) : voit A ET B.
    const platformRows = (await h.query(networkSql, [PERIOD_START, PERIOD_END]))
      .rows as Array<{ tickets_issued: number; agency_id: string }>;
    const total = platformRows.reduce((s, r) => s + Number(r.tickets_issued), 0);
    const agencies = new Set(platformRows.map((r) => r.agency_id));
    expect(agencies.size).toBe(2); // A + B — l'agrégat réseau voit bien les 2 banques.
    expect(total).toBe(100); // 40 (A) + 60 (B) — cross-tenant préservé.

    // CONTRASTE : la MÊME requête réseau ARMÉE sur A ne verrait QUE A (donc l'armer
    // casserait l'agrégat réseau — d'où le split vers withPlatform, jamais armé).
    const armedRows = await withArmedTenant(armable(h), bankA, async (conn) =>
      (await conn.query(networkSql, [PERIOD_START, PERIOD_END])).rows as Array<{
        tickets_issued: number;
        agency_id: string;
      }>
    );
    const armedTotal = armedRows.reduce((s, r) => s + Number(r.tickets_issued), 0);
    expect(new Set(armedRows.map((r) => r.agency_id)).size).toBe(1); // que A.
    expect(armedTotal).toBe(40); // agrégat tronqué à A — preuve que le réseau NE doit PAS être armé.
  }, 60_000);
});
