/**
 * IA-001 — Tests unitaires du moteur de features (fonctions PURES, déterministes).
 *
 * Couvre les critères ⊛ :
 *  - features lag (lag_1d, lag_7d, roll_mean_4w) exactes sur série synthétique ;
 *  - buckets incomplets → is_partial=true, aucune imputation ;
 *  - available_days par agence cohérent avec le seuil ;
 *  - mesures de bucket dérivées des sommes REP-001 (avg = somme/served) ;
 *  - idempotence de calcul (mêmes entrées ⇒ mêmes sorties, ordre stable).
 *
 * Nommage strict : `IA-001: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  computeFeatureSet,
  canonicalKey,
  sortByCanonicalKey,
  FEATURE_SET_VERSION,
  HISTORY_THRESHOLD_DAYS,
  type RawBucketObservation,
  type FeatureComputeOptions,
} from "src/ai/feature-engine.js";

const BANK = "11111111-1111-4111-8111-111111111111";
const AGENCY = "22222222-2222-4222-8222-222222222222";

/** Horloge très postérieure → tous les jours de test sont figés (isPartial=false). */
const FROZEN_NOW = new Date("2027-01-01T00:00:00Z");

/** Observation de base (helper) — bucket 60 min, complet, un service null. */
function obs(date: string, hourBucket: number, arrivals: number): RawBucketObservation {
  return {
    bankId: BANK,
    agencyId: AGENCY,
    serviceId: null,
    date,
    hourBucket,
    bucketMinutes: 60,
    arrivals,
    served: arrivals,
    noShow: 0,
    abandoned: 0,
    totalWaitSeconds: arrivals * 120, // 120 s moyen par ticket servi
    p90WaitSeconds: 200,
    totalServiceSeconds: arrivals * 300,
    countersOpen: 2,
    agentsActive: 2,
    isPartialSource: false,
  };
}

const OPTS: FeatureComputeOptions = {
  holidays: new Set<string>(),
  now: FROZEN_NOW,
};

describe("feature-engine", () => {
  it("IA-001: avg_wait/avg_service = somme REP-001 / served (jamais recalculé à la main)", () => {
    const rec = computeFeatureSet([obs("2026-06-10", 9, 10)], OPTS)[0]!;
    // 10 servis, 1200 s d'attente totale → 120 s moyen ; 3000 s service → 300 s.
    expect(rec.avgWaitSeconds).toBe(120);
    expect(rec.avgServiceSeconds).toBe(300);
    expect(rec.p90WaitSeconds).toBe(200);
    expect(rec.featureSetVersion).toBe(FEATURE_SET_VERSION);
  });

  it("IA-001: served=0 → avg_wait/avg_service = null (pas de division par zéro)", () => {
    const zero: RawBucketObservation = { ...obs("2026-06-10", 9, 0), served: 0, arrivals: 3 };
    const rec = computeFeatureSet([zero], OPTS)[0]!;
    expect(rec.avgWaitSeconds).toBeNull();
    expect(rec.avgServiceSeconds).toBeNull();
  });

  it("IA-001: features lag (lag_1d, lag_7d, roll_mean_4w) exactes sur série connue", () => {
    // Même bucket 9h, arrivées J-28..J : 4 semaines de lags + veille.
    const series = [
      obs("2026-05-13", 9, 40), // J-28
      obs("2026-05-20", 9, 30), // J-21
      obs("2026-05-27", 9, 20), // J-14
      obs("2026-06-03", 9, 10), // J-7
      obs("2026-06-09", 9, 99), // J-1
      obs("2026-06-10", 9, 50), // J (cible)
    ];
    const recs = computeFeatureSet(series, OPTS);
    const target = recs.find((r) => r.date === "2026-06-10");
    expect(target).toBeDefined();
    expect(target?.arrivalsLag1d).toBe(99); // J-1
    expect(target?.arrivalsLag7d).toBe(10); // J-7
    // roll_mean_4w = moyenne (10, 20, 30, 40) = 25.
    expect(target?.arrivalsRollMean4w).toBe(25);
  });

  it("IA-001: lags absents → null, roll_mean_4w = moyenne des seuls points présents (pas d'imputation à 0)", () => {
    // Seuls J-7 et J présents.
    const recs = computeFeatureSet([obs("2026-06-03", 9, 12), obs("2026-06-10", 9, 50)], OPTS);
    const target = recs.find((r) => r.date === "2026-06-10");
    expect(target?.arrivalsLag1d).toBeNull();
    expect(target?.arrivalsLag7d).toBe(12);
    // Un seul point présent (J-7) → moyenne = 12, pas 12/4.
    expect(target?.arrivalsRollMean4w).toBe(12);
  });

  it("IA-001: lags isolés par (agence, service, bucket) — pas de collision entre buckets", () => {
    // Deux buckets différents le même jour ; le lag ne doit pas se mélanger.
    const recs = computeFeatureSet(
      [obs("2026-06-03", 9, 7), obs("2026-06-03", 10, 99), obs("2026-06-10", 9, 50)],
      OPTS
    );
    const target = recs.find((r) => r.date === "2026-06-10" && r.hourBucket === 9);
    expect(target?.arrivalsLag7d).toBe(7); // bucket 9, pas 99 du bucket 10
  });

  it("IA-001: buckets incomplets → is_partial=true, aucune valeur fabriquée", () => {
    const partial: RawBucketObservation = { ...obs("2026-06-10", 9, 5), isPartialSource: true };
    const rec = computeFeatureSet([partial], OPTS)[0]!;
    expect(rec.isPartial).toBe(true);
    // Les mesures restent celles fournies (aucune imputation).
    expect(rec.arrivals).toBe(5);
    expect(rec.served).toBe(5);
  });

  it("IA-001: jour non encore figé → is_partial=true (horloge injectée, aligné REP-001)", () => {
    // now juste après le jour → jour non figé (figé à J+2 07:00 Abidjan).
    const nowEarly = new Date("2026-06-11T00:00:00Z");
    const rec = computeFeatureSet([obs("2026-06-10", 9, 5)], {
      holidays: new Set(),
      now: nowEarly,
    })[0]!;
    expect(rec.isPartial).toBe(true);
  });

  it("IA-001: available_days par agence = nb de jours civils distincts observés", () => {
    const recs = computeFeatureSet(
      [obs("2026-06-08", 9, 1), obs("2026-06-09", 9, 1), obs("2026-06-09", 10, 1)],
      OPTS
    );
    // 2 jours distincts (08, 09) malgré 3 buckets.
    for (const r of recs) expect(r.availableDays).toBe(2);
  });

  it("IA-001: available_days < seuil 90 j reflète l'historique réel", () => {
    const recs = computeFeatureSet([obs("2026-06-10", 9, 1)], OPTS);
    expect(recs[0]?.availableDays).toBe(1);
    expect(recs[0]?.availableDays).toBeLessThan(HISTORY_THRESHOLD_DAYS);
  });

  it("IA-001: idempotence de calcul — mêmes entrées ⇒ mêmes sorties (JSON stable)", () => {
    const series = [obs("2026-06-10", 9, 5), obs("2026-06-09", 9, 3)];
    const a = computeFeatureSet(series, OPTS);
    const b = computeFeatureSet([...series].reverse(), OPTS); // ordre d'entrée différent
    // Le tri par clé canonique rend la sortie indépendante de l'ordre d'entrée.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("IA-001: bucket 30 min supporté sans changement de schéma", () => {
    const b30: RawBucketObservation = { ...obs("2026-06-10", 19, 4), bucketMinutes: 30 };
    const rec = computeFeatureSet([b30], OPTS)[0]!;
    expect(rec.bucketMinutes).toBe(30);
    expect(rec.hourBucket).toBe(19);
  });

  it("IA-001: sortByCanonicalKey ordonne par (bank, agency, service, date, bucket)", () => {
    const recs = sortByCanonicalKey([
      obs("2026-06-10", 10, 1),
      obs("2026-06-10", 9, 1),
      obs("2026-06-09", 9, 1),
    ].map((o) => computeFeatureSet([o], OPTS)[0]!));
    expect(recs.map((r) => `${r.date}#${r.hourBucket}`)).toEqual([
      "2026-06-09#9",
      "2026-06-10#9",
      "2026-06-10#10",
    ]);
  });

  it("IA-001: canonicalKey inclut le bankId (isolation)", () => {
    const base = { agencyId: AGENCY, serviceId: null, date: "2026-06-10", hourBucket: 9 };
    const kA = canonicalKey({ ...base, bankId: BANK });
    const kB = canonicalKey({ ...base, bankId: "33333333-3333-4333-8333-333333333333" });
    expect(kA).not.toBe(kB);
  });

  it("IA-001: tri stable départage par bank puis agence puis service (branches comparateur)", () => {
    const BANK2 = "aaaaaaaa-1111-4111-8111-111111111111";
    const AGENCY2 = "99999999-9999-4999-8999-999999999999";
    const mk = (bankId: string, agencyId: string, serviceId: string | null): RawBucketObservation => ({
      ...obs("2026-06-10", 9, 1),
      bankId,
      agencyId,
      serviceId,
    });
    const recs = sortByCanonicalKey([
      computeFeatureSet([mk(BANK, AGENCY, "s2")], OPTS)[0]!,
      computeFeatureSet([mk(BANK, AGENCY, "s1")], OPTS)[0]!,
      computeFeatureSet([mk(BANK, AGENCY2, null)], OPTS)[0]!,
      computeFeatureSet([mk(BANK2, AGENCY, null)], OPTS)[0]!,
    ]);
    // bank BANK (< BANK2 alpha) d'abord ; à bank égal, agence AGENCY (2…) < AGENCY2 (9…) ;
    // à agence égale, service null trié comme "" (< "s1" < "s2").
    expect(recs[0]?.bankId).toBe(BANK);
    expect(recs.at(-1)?.bankId).toBe(BANK2);
    const bankRecs = recs.filter((r) => r.bankId === BANK && r.agencyId === AGENCY);
    expect(bankRecs.map((r) => r.serviceId)).toEqual(["s1", "s2"]);
  });
});
