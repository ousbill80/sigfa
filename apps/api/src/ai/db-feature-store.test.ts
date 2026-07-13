/**
 * F10-FEATURE-STORE — Tests unitaires du store DB-backed `ai_features`, SANS conteneur.
 *
 * On injecte une `FeatureStoreQuery` stub qui capture le SQL + les valeurs et rend
 * des lignes contrôlées. Couvre :
 *  - mapping PUR row ↔ FeatureRecord (aller-retour fidèle, factors JSONB, nullables) ;
 *  - upsert idempotent (SQL ON CONFLICT sur la clé canonique, comptage appliqué) ;
 *  - lectures tenant-scopées (getByBank / getByAgency : `WHERE bank_id` toujours
 *    présent, tri canonique) et count.
 *
 * Le SQL exact exécuté ici est CELUI de production ; l'armement RLS est prouvé par la
 * suite `tenant-isolation` (Testcontainers). Nommage strict : `F10: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  DbFeatureStore,
  asFeatureStoreQuery,
  rowToFeatureRecord,
  featureRecordToParams,
  type FeatureStoreQuery,
} from "src/ai/db-feature-store.js";
import { computeFeatureSet, type RawBucketObservation } from "src/ai/feature-engine.js";

const BANK_A = "11111111-1111-4111-8111-111111111111";
const AGENCY = "22222222-2222-4222-8222-222222222222";
const FROZEN_NOW = new Date("2027-01-01T00:00:00Z");

function obs(date: string, hourBucket: number, arrivals: number): RawBucketObservation {
  return {
    bankId: BANK_A,
    agencyId: AGENCY,
    serviceId: null,
    date,
    hourBucket,
    bucketMinutes: 60,
    arrivals,
    served: arrivals,
    noShow: 1,
    abandoned: 0,
    totalWaitSeconds: arrivals * 30,
    p90WaitSeconds: 120,
    totalServiceSeconds: arrivals * 60,
    countersOpen: 2,
    agentsActive: 2,
    isPartialSource: false,
  };
}

/** Stub de query : capture les appels et rend des lignes programmées. */
function stubQuery(rowsByCall: Array<Array<Record<string, unknown>>>): {
  query: FeatureStoreQuery;
  calls: Array<{ sql: string; values: unknown[] | undefined }>;
} {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  let i = 0;
  const query: FeatureStoreQuery = async (sql, values) => {
    calls.push({ sql, values });
    const rows = rowsByCall[i] ?? [];
    i += 1;
    return { rows };
  };
  return { query, calls };
}

/** Ligne `ai_features` brute (snake_case pg) équivalente à un record simple. */
function dbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bank_id: BANK_A,
    agency_id: AGENCY,
    service_id: null,
    date: "2026-06-10",
    hour_bucket: 9,
    bucket_minutes: 60,
    arrivals: 5,
    served: 5,
    no_show: 1,
    abandoned: 0,
    avg_wait_seconds: 30,
    p90_wait_seconds: 120,
    avg_service_seconds: 60,
    counters_open: 2,
    agents_active: 2,
    day_of_week: 3,
    is_month_end: false,
    is_public_pay_day: false,
    is_public_holiday: false,
    is_eve_of_holiday: false,
    factors: ["NONE"],
    arrivals_lag_1d: null,
    arrivals_lag_7d: null,
    arrivals_roll_mean_4w: null,
    is_partial: false,
    available_days: 1,
    feature_set_version: "fs-v1",
    ...overrides,
  };
}

describe("db-feature-store", () => {
  it("F10: rowToFeatureRecord — mapping fidèle snake_case → camelCase (factors, nullables)", () => {
    const rec = rowToFeatureRecord(
      dbRow({
        service_id: "svc-1",
        avg_wait_seconds: null,
        avg_service_seconds: null,
        arrivals_lag_1d: 4,
        arrivals_roll_mean_4w: 3.5,
        factors: ["END_OF_MONTH", "CIVIL_SERVICE_PAY"],
        is_partial: true,
      })
    );
    expect(rec.bankId).toBe(BANK_A);
    expect(rec.agencyId).toBe(AGENCY);
    expect(rec.serviceId).toBe("svc-1");
    expect(rec.date).toBe("2026-06-10");
    expect(rec.hourBucket).toBe(9);
    expect(rec.avgWaitSeconds).toBeNull();
    expect(rec.avgServiceSeconds).toBeNull();
    expect(rec.arrivalsLag1d).toBe(4);
    expect(rec.arrivalsRollMean4w).toBe(3.5);
    expect(rec.factors).toEqual(["END_OF_MONTH", "CIVIL_SERVICE_PAY"]);
    expect(rec.isPartial).toBe(true);
    expect(rec.featureSetVersion).toBe("fs-v1");
  });

  it("F10: rowToFeatureRecord — service_id NULL préservé, date en Date normalisée YYYY-MM-DD", () => {
    const rec = rowToFeatureRecord(dbRow({ service_id: null, date: new Date("2026-06-10T00:00:00Z") }));
    expect(rec.serviceId).toBeNull();
    expect(rec.date).toBe("2026-06-10");
  });

  it("F10: rowToFeatureRecord — factors non-tableau/inconnu retombe sur ['NONE'] (défense)", () => {
    expect(rowToFeatureRecord(dbRow({ factors: null })).factors).toEqual(["NONE"]);
    expect(rowToFeatureRecord(dbRow({ factors: ["BOGUS"] })).factors).toEqual(["NONE"]);
  });

  it("F10: featureRecordToParams — 27 paramètres alignés, factors sérialisé JSONB", () => {
    const [rec] = computeFeatureSet([obs("2026-06-10", 9, 5)], { holidays: new Set(), now: FROZEN_NOW });
    const params = featureRecordToParams(rec!);
    expect(params).toHaveLength(27);
    expect(params[0]).toBe(BANK_A); // bank_id
    expect(params[1]).toBe(AGENCY); // agency_id
    expect(params[2]).toBeNull(); // service_id
    expect(params[20]).toBe(JSON.stringify(rec!.factors)); // factors JSONB
    expect(params[26]).toBe("fs-v1"); // feature_set_version
  });

  it("F10: aller-retour params → row → record reste fidèle (round-trip du mapping)", () => {
    const [rec] = computeFeatureSet([obs("2026-06-10", 9, 5)], { holidays: new Set(), now: FROZEN_NOW });
    const params = featureRecordToParams(rec!);
    // Reconstruit une ligne DB depuis les params (simulateur d'un RETURNING *).
    const back = rowToFeatureRecord(
      dbRow({
        arrivals: params[6],
        served: params[7],
        no_show: params[8],
        avg_wait_seconds: params[10],
        p90_wait_seconds: params[11],
        avg_service_seconds: params[12],
        factors: rec!.factors,
        available_days: params[25],
      })
    );
    expect(back.arrivals).toBe(rec!.arrivals);
    expect(back.avgWaitSeconds).toBe(rec!.avgWaitSeconds);
    expect(back.p90WaitSeconds).toBe(rec!.p90WaitSeconds);
    expect(back.availableDays).toBe(rec!.availableDays);
  });

  it("F10: upsertMany — ON CONFLICT sur la clé canonique, comptage des lignes appliquées", async () => {
    const features = computeFeatureSet(
      [obs("2026-06-10", 9, 5), obs("2026-06-10", 10, 8)],
      { holidays: new Set(), now: FROZEN_NOW }
    );
    // Chaque INSERT ... RETURNING id renvoie 1 ligne.
    const { query, calls } = stubQuery([[{ id: "row-1" }], [{ id: "row-2" }]]);
    const applied = await new DbFeatureStore(query).upsertMany(features);
    expect(applied).toBe(2);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.sql).toContain("INSERT INTO ai_features");
      expect(call.sql).toContain(
        "ON CONFLICT (bank_id, agency_id, service_id, date, hour_bucket, feature_set_version)"
      );
      expect(call.sql).toContain("DO UPDATE SET");
      expect(call.values).toHaveLength(27);
    }
  });

  it("F10: getByBank — WHERE bank_id = $1 (tenant-scopé), tri canonique appliqué", async () => {
    // Renvoyées en désordre → doivent ressortir triées (bucket 9 avant 10).
    const { query, calls } = stubQuery([
      [dbRow({ hour_bucket: 10, arrivals: 8 }), dbRow({ hour_bucket: 9, arrivals: 5 })],
    ]);
    const rows = await new DbFeatureStore(query).getByBank(BANK_A);
    expect(calls[0]?.sql).toContain("WHERE bank_id = $1");
    expect(calls[0]?.values).toEqual([BANK_A]);
    expect(rows.map((r) => r.hourBucket)).toEqual([9, 10]);
  });

  it("F10: getByAgency — WHERE bank_id = $1 AND agency_id = $2 (borne agence)", async () => {
    const { query, calls } = stubQuery([[dbRow()]]);
    const rows = await new DbFeatureStore(query).getByAgency(BANK_A, AGENCY);
    expect(calls[0]?.sql).toContain("WHERE bank_id = $1 AND agency_id = $2");
    expect(calls[0]?.values).toEqual([BANK_A, AGENCY]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.agencyId).toBe(AGENCY);
  });

  it("F10: count — COUNT(*) WHERE bank_id, retourne l'entier", async () => {
    const { query, calls } = stubQuery([[{ total: 42 }]]);
    const n = await new DbFeatureStore(query).count(BANK_A);
    expect(calls[0]?.sql).toContain("COUNT(*)");
    expect(calls[0]?.sql).toContain("WHERE bank_id = $1");
    expect(n).toBe(42);
  });

  it("F10: count — absence de ligne → 0 (jamais NaN)", async () => {
    const { query } = stubQuery([[]]);
    expect(await new DbFeatureStore(query).count(BANK_A)).toBe(0);
  });

  it("F10: asFeatureStoreQuery — adapte une connexion pg (query(sql, values)) en FeatureStoreQuery", async () => {
    const captured: Array<{ sql: string; values?: unknown[] }> = [];
    const conn = {
      query: async (sql: string, values?: unknown[]) => {
        captured.push({ sql, values });
        return { rows: [dbRow()] as unknown[] };
      },
    };
    const q = asFeatureStoreQuery(conn);
    const res = await q("SELECT 1", [BANK_A]);
    expect(captured[0]?.sql).toBe("SELECT 1");
    expect(captured[0]?.values).toEqual([BANK_A]);
    expect(res.rows).toHaveLength(1);
  });
});
