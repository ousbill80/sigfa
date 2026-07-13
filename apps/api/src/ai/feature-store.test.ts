/**
 * IA-001 — Tests unitaires de la matérialisation en mémoire (upsert idempotent,
 * isolation tenant). Couvre les critères ⊛ idempotence et isolation.
 *
 * Nommage strict : `IA-001: <description>`.
 *
 * @module
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryFeatureStore } from "src/ai/feature-store.js";
import {
  computeFeatureSet,
  type RawBucketObservation,
  type FeatureComputeOptions,
} from "src/ai/feature-engine.js";

const BANK_A = "11111111-1111-4111-8111-111111111111";
const BANK_B = "44444444-4444-4444-8444-444444444444";
const AGENCY = "22222222-2222-4222-8222-222222222222";
const FROZEN_NOW = new Date("2027-01-01T00:00:00Z");
const OPTS: FeatureComputeOptions = { holidays: new Set(), now: FROZEN_NOW };

function obs(bankId: string, date: string, hourBucket: number, arrivals: number): RawBucketObservation {
  return {
    bankId,
    agencyId: AGENCY,
    serviceId: null,
    date,
    hourBucket,
    bucketMinutes: 60,
    arrivals,
    served: arrivals,
    noShow: 0,
    abandoned: 0,
    totalWaitSeconds: 0,
    p90WaitSeconds: 0,
    totalServiceSeconds: 0,
    countersOpen: 1,
    agentsActive: 1,
    isPartialSource: false,
  };
}

describe("feature-store", () => {
  let store: InMemoryFeatureStore;
  beforeEach(() => {
    store = new InMemoryFeatureStore();
  });

  it("IA-001: upsert idempotent — re-run même fenêtre = zéro doublon", () => {
    const features = computeFeatureSet(
      [obs(BANK_A, "2026-06-10", 9, 5), obs(BANK_A, "2026-06-10", 10, 8)],
      OPTS
    );
    store.upsertMany(features);
    store.upsertMany(features); // rejeu
    expect(store.count(BANK_A)).toBe(2);
  });

  it("IA-001: recomputation rejouée avec valeur corrigée reconverge (upsert écrase)", () => {
    store.upsertMany(computeFeatureSet([obs(BANK_A, "2026-06-10", 9, 5)], OPTS));
    // Correction rétroactive : même clé, arrivals corrigé.
    store.upsertMany(computeFeatureSet([obs(BANK_A, "2026-06-10", 9, 42)], OPTS));
    const rows = store.getByBank(BANK_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.arrivals).toBe(42);
  });

  it("IA-001: isolation tenant — getByBank(A) ne renvoie jamais de ligne de B", () => {
    store.upsertMany(computeFeatureSet([obs(BANK_A, "2026-06-10", 9, 5)], OPTS));
    store.upsertMany(computeFeatureSet([obs(BANK_B, "2026-06-10", 9, 7)], OPTS));
    const rowsA = store.getByBank(BANK_A);
    const rowsB = store.getByBank(BANK_B);
    expect(rowsA.every((r) => r.bankId === BANK_A)).toBe(true);
    expect(rowsB.every((r) => r.bankId === BANK_B)).toBe(true);
    expect(store.count(BANK_A)).toBe(1);
    expect(store.count(BANK_B)).toBe(1);
  });

  it("IA-001: clés distinctes bank A/B ne collisionnent pas (même agence/jour/bucket)", () => {
    store.upsertMany(computeFeatureSet([obs(BANK_A, "2026-06-10", 9, 5)], OPTS));
    store.upsertMany(computeFeatureSet([obs(BANK_B, "2026-06-10", 9, 7)], OPTS));
    expect(store.getByBank(BANK_A)[0]?.arrivals).toBe(5);
    expect(store.getByBank(BANK_B)[0]?.arrivals).toBe(7);
  });

  it("IA-001: clear vide entièrement le store", () => {
    store.upsertMany(computeFeatureSet([obs(BANK_A, "2026-06-10", 9, 5)], OPTS));
    store.clear();
    expect(store.count(BANK_A)).toBe(0);
  });
});
