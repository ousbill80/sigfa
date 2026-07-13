/**
 * IA-001 — Tests unitaires de la fenêtre d'historique / seuil INSUFFICIENT_HISTORY.
 *
 * Couvre le critère ⊛ : available_days par agence cohérent avec le seuil 90 j,
 * réutilisé tel quel par les endpoints IA (CONTRACT-008).
 *
 * Nommage strict : `IA-001: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  computeAgencyHistoryStatus,
  insufficientHistoryDetails,
} from "src/ai/history-window.js";
import {
  computeFeatureSet,
  HISTORY_THRESHOLD_DAYS,
  type RawBucketObservation,
  type FeatureComputeOptions,
} from "src/ai/feature-engine.js";

const BANK = "11111111-1111-4111-8111-111111111111";
const AGENCY_A = "22222222-2222-4222-8222-222222222222";
const AGENCY_B = "33333333-3333-4333-8333-333333333333";
const FROZEN_NOW = new Date("2027-01-01T00:00:00Z");
const OPTS: FeatureComputeOptions = { holidays: new Set(), now: FROZEN_NOW };

function obs(agencyId: string, date: string): RawBucketObservation {
  return {
    bankId: BANK,
    agencyId,
    serviceId: null,
    date,
    hourBucket: 9,
    bucketMinutes: 60,
    arrivals: 1,
    served: 1,
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

/** Génère `n` jours consécutifs à partir de `start` (YYYY-MM-DD). */
function daysFrom(start: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i += 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("history-window", () => {
  it("IA-001: available_days par agence = jours distincts, seuil = 90 j", () => {
    const recs = computeFeatureSet(
      [...daysFrom("2026-01-01", 40).map((d) => obs(AGENCY_A, d))],
      OPTS
    );
    const status = computeAgencyHistoryStatus(recs);
    expect(status.get(AGENCY_A)?.availableDays).toBe(40);
    expect(status.get(AGENCY_A)?.requiredDays).toBe(HISTORY_THRESHOLD_DAYS);
    expect(status.get(AGENCY_A)?.sufficient).toBe(false);
  });

  it("IA-001: ≥90 j → sufficient=true, details=null", () => {
    const recs = computeFeatureSet(
      [...daysFrom("2026-01-01", 95).map((d) => obs(AGENCY_A, d))],
      OPTS
    );
    const status = computeAgencyHistoryStatus(recs);
    const s = status.get(AGENCY_A)!;
    expect(s.sufficient).toBe(true);
    expect(insufficientHistoryDetails(s)).toBeNull();
  });

  it("IA-001: <90 j → details INSUFFICIENT_HISTORY forme CONTRACT-008", () => {
    const recs = computeFeatureSet(
      [...daysFrom("2026-01-01", 42).map((d) => obs(AGENCY_A, d))],
      OPTS
    );
    const s = computeAgencyHistoryStatus(recs).get(AGENCY_A)!;
    expect(insufficientHistoryDetails(s)).toEqual({ requiredDays: 90, availableDays: 42 });
  });

  it("IA-001: statut calculé indépendamment par agence", () => {
    const recs = computeFeatureSet(
      [
        ...daysFrom("2026-01-01", 95).map((d) => obs(AGENCY_A, d)),
        ...daysFrom("2026-01-01", 10).map((d) => obs(AGENCY_B, d)),
      ],
      OPTS
    );
    const status = computeAgencyHistoryStatus(recs);
    expect(status.get(AGENCY_A)?.sufficient).toBe(true);
    expect(status.get(AGENCY_B)?.sufficient).toBe(false);
    expect(status.get(AGENCY_B)?.availableDays).toBe(10);
  });
});
