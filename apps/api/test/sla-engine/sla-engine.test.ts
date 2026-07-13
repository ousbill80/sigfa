/**
 * REP-001 — Suite d'exactitude `sla-engine` (fonctions PURES, déterministes).
 *
 * Aucune I/O, aucun accès DB, aucune horloge cachée : l'horloge est INJECTÉE.
 * Les fixtures sont déterministes (valeurs fixes). Chaque test mappe un critère
 * d'acceptation EARS de REP-001 (formules D2 = LA LOI, PO-confirmées 2026-07-12).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  tma,
  tmt,
  tts,
  tauxAbandon,
  tauxSla,
  nps,
  occupation,
  sumAggregates,
  computeKpiSet,
  emptyAggregate,
  toAbidjanDay,
  isDayPartial,
  ABIDJAN_TZ,
  type DailyStatsAggregate,
} from "src/reporting/sla-engine.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture déterministe (alignée sur DB-006 reporting-fixture, jour 2026-07-01)
// 4 DONE, 1 ABANDONED, 1 NO_SHOW.
//   waits  DONE : 300, 600, 1200, 450  → total 2550
//   svc    DONE : 600, 480, 360, 720   → total 2160
//   SLA (900s)  : 3 met sur 4 appelés+abandon = 4 total (abandon = non-met)
//   feedback    : 5(prom), 4(pass), 2(detr) → prom1 pass1 detr1, count 3
//   occupation  : active 8h (28800s) / available 8h (28800s) → 100 %
// ─────────────────────────────────────────────────────────────────────────────

/** Agrégat de référence de la fixture (jour figé). */
const FIXTURE: DailyStatsAggregate = {
  ticketsIssued: 6,
  servedCount: 4,
  doneCount: 4,
  abandonedCount: 1,
  noShowCount: 1,
  totalWaitSeconds: 2550,
  totalServiceSeconds: 2160,
  slaMetCount: 3,
  slaTotalCount: 4,
  feedbackCount: 3,
  npsPromoters: 1,
  npsPassives: 1,
  npsDetractors: 1,
  agentActiveSeconds: 28800,
  agentAvailableSeconds: 28800,
};

describe("REP-001: sla-engine — TMA", () => {
  it("REP-001: TMA = total_wait_seconds/served_count — fixture déterministe → valeur exacte à la seconde", () => {
    // 2550 / 4 = 637.5 → arrondi au plus proche = 638 s
    expect(tma(FIXTURE)).toBe(638);
  });

  it("REP-001: TMA arrondi au plus proche (pas de troncature)", () => {
    expect(tma({ ...emptyAggregate(), servedCount: 2, totalWaitSeconds: 301 })).toBe(151); // 150.5 → 151
  });

  it("REP-001: TMA null si served_count = 0 (jamais 0/NaN/div0)", () => {
    expect(tma({ ...emptyAggregate(), servedCount: 0, totalWaitSeconds: 0 })).toBeNull();
  });
});

describe("REP-001: sla-engine — TMT", () => {
  it("REP-001: TMT = total_service_seconds/done_count sur DONE uniquement", () => {
    // 2160 / 4 = 540 s
    expect(tmt(FIXTURE)).toBe(540);
  });

  it("REP-001: TMT null si done_count = 0", () => {
    expect(tmt({ ...emptyAggregate(), doneCount: 0, totalServiceSeconds: 0 })).toBeNull();
  });
});

describe("REP-001: sla-engine — TTS", () => {
  it("REP-001: TTS = TMA + TMT", () => {
    expect(tts(FIXTURE)).toBe(638 + 540);
  });

  it("REP-001: TTS null si TMA null", () => {
    const noServed: DailyStatsAggregate = { ...FIXTURE, servedCount: 0, totalWaitSeconds: 0 };
    expect(tts(noServed)).toBeNull();
  });

  it("REP-001: TTS null si TMT null", () => {
    const noDone: DailyStatsAggregate = { ...FIXTURE, doneCount: 0, totalServiceSeconds: 0 };
    expect(tts(noDone)).toBeNull();
  });
});

describe("REP-001: sla-engine — taux d'abandon", () => {
  it("REP-001: abandon = ABANDONED/(ABANDONED+served) ; NO_SHOW exclu du numérateur (4 issues)", () => {
    // 1 / (1 + 4) = 20.00 %
    expect(tauxAbandon(FIXTURE)).toBe(20);
  });

  it("REP-001: abandon à 2 décimales", () => {
    // 1 / (1 + 2) = 33.333... → 33.33
    expect(tauxAbandon({ ...emptyAggregate(), abandonedCount: 1, servedCount: 2 })).toBe(33.33);
  });

  it("REP-001: abandon null si dénominateur = 0 (aucun abandon ni servi)", () => {
    expect(tauxAbandon({ ...emptyAggregate(), abandonedCount: 0, servedCount: 0 })).toBeNull();
  });
});

describe("REP-001: sla-engine — taux SLA", () => {
  it("REP-001: SLA = sla_met/sla_total ; abandon compté non-met", () => {
    // 3 / 4 = 75.00 %
    expect(tauxSla(FIXTURE)).toBe(75);
  });

  it("REP-001: SLA borne exacte à wait = SLA (≤ inclusif) → met", () => {
    // 1 met sur 1 total = 100 % (borne incluse encodée en amont dans slaMetCount)
    expect(tauxSla({ ...emptyAggregate(), slaMetCount: 1, slaTotalCount: 1 })).toBe(100);
  });

  it("REP-001: SLA null si sla_total_count = 0", () => {
    expect(tauxSla({ ...emptyAggregate(), slaMetCount: 0, slaTotalCount: 0 })).toBeNull();
  });
});

describe("REP-001: sla-engine — NPS", () => {
  it("REP-001: NPS = (promoters−detractors)/feedback_count×100 ; 5→prom,4→pass,≤3→detr", () => {
    // (1 - 1) / 3 * 100 = 0
    expect(nps(FIXTURE)).toBe(0);
  });

  it("REP-001: NPS borne +100 (tous promoteurs)", () => {
    expect(nps({ ...emptyAggregate(), feedbackCount: 4, npsPromoters: 4 })).toBe(100);
  });

  it("REP-001: NPS borne −100 (tous détracteurs)", () => {
    expect(nps({ ...emptyAggregate(), feedbackCount: 4, npsDetractors: 4 })).toBe(-100);
  });

  it("REP-001: NPS null si feedback_count = 0 (jamais 0 fallacieux)", () => {
    expect(nps({ ...emptyAggregate(), feedbackCount: 0 })).toBeNull();
  });
});

describe("REP-001: sla-engine — occupation", () => {
  it("REP-001: occupation = active/available×100 (par-agent)", () => {
    // 28800 / 28800 * 100 = 100
    expect(occupation(FIXTURE)).toBe(100);
  });

  it("REP-001: occupation plafonnée à 100 (active > available)", () => {
    expect(
      occupation({ ...emptyAggregate(), agentActiveSeconds: 200, agentAvailableSeconds: 100 })
    ).toBe(100);
  });

  it("REP-001: occupation 2 décimales", () => {
    // 3600 / 7200 * 100 = 50
    expect(
      occupation({ ...emptyAggregate(), agentActiveSeconds: 3600, agentAvailableSeconds: 7200 })
    ).toBe(50);
  });

  it("REP-001: occupation null si available = 0 (jamais div0)", () => {
    expect(
      occupation({ ...emptyAggregate(), agentActiveSeconds: 0, agentAvailableSeconds: 0 })
    ).toBeNull();
  });

  it("REP-001: occupation null si available inconnu (null)", () => {
    expect(
      occupation({ ...emptyAggregate(), agentActiveSeconds: null, agentAvailableSeconds: null })
    ).toBeNull();
  });
});

describe("REP-001: sla-engine — CAS DE BORD file vide / 0 observation (7 KPIs)", () => {
  const empty = emptyAggregate();
  it.each([
    ["tma", tma],
    ["tmt", tmt],
    ["tts", tts],
    ["tauxAbandon", tauxAbandon],
    ["tauxSla", tauxSla],
    ["nps", nps],
    ["occupation", occupation],
  ])("REP-001: %s sur file vide → null (jamais 0/NaN/div0)", (_name, fn) => {
    const value = (fn as (a: DailyStatsAggregate) => number | null)(empty);
    expect(value).toBeNull();
    expect(Number.isNaN(value ?? 0)).toBe(false);
  });
});

describe("REP-001: sla-engine — agrégation multi-jours = somme puis division", () => {
  it("REP-001: 2 jours asymétriques → moyenne pondérée exacte (jamais moyenne de moyennes)", () => {
    // Jour A : 1 servi, wait 100 → TMA_A = 100
    // Jour B : 3 servis, wait 900 → TMA_B = 300
    // Moyenne de moyennes (INTERDITE) = (100+300)/2 = 200
    // Somme puis division (CORRECTE) = (100+900)/(1+3) = 1000/4 = 250
    const dayA: DailyStatsAggregate = { ...emptyAggregate(), servedCount: 1, totalWaitSeconds: 100 };
    const dayB: DailyStatsAggregate = { ...emptyAggregate(), servedCount: 3, totalWaitSeconds: 900 };
    const merged = sumAggregates([dayA, dayB]);
    expect(merged.servedCount).toBe(4);
    expect(merged.totalWaitSeconds).toBe(1000);
    expect(tma(merged)).toBe(250);
  });

  it("REP-001: sumAggregates additionne agentAvailableSeconds (null traité comme 0 s'il reste des données)", () => {
    const dayA: DailyStatsAggregate = {
      ...emptyAggregate(),
      agentActiveSeconds: 100,
      agentAvailableSeconds: 200,
    };
    const dayB: DailyStatsAggregate = {
      ...emptyAggregate(),
      agentActiveSeconds: null,
      agentAvailableSeconds: null,
    };
    const merged = sumAggregates([dayA, dayB]);
    expect(merged.agentActiveSeconds).toBe(100);
    expect(merged.agentAvailableSeconds).toBe(200);
  });

  it("REP-001: sumAggregates([]) → agrégat vide (occupation available null)", () => {
    const merged = sumAggregates([]);
    expect(merged.agentAvailableSeconds).toBeNull();
    expect(occupation(merged)).toBeNull();
  });
});

describe("REP-001: sla-engine — computeKpiSet (forme contractuelle KpiSet)", () => {
  it("REP-001: computeKpiSet retourne les 7 KPIs typés avec unités", () => {
    // Moteur PUR : TMA/TMT/TTS calculés en SECONDES (source total_*_seconds).
    // La conversion secondes → minutes se fait à la FRONTIÈRE ROUTE (reports.ts),
    // seul endroit où `unit:"minutes"` devient VRAI vis-à-vis de la valeur exposée.
    const kpis = computeKpiSet(FIXTURE);
    expect(kpis.tma).toEqual({ value: 638, unit: "minutes" });
    expect(kpis.tmt).toEqual({ value: 540, unit: "minutes" });
    expect(kpis.tts).toEqual({ value: 1178, unit: "minutes" });
    expect(kpis.tauxAbandon).toEqual({ value: 20, unit: "percent" });
    expect(kpis.tauxSLA).toEqual({ value: 75, unit: "percent" });
    expect(kpis.nps).toBe(0);
    expect(kpis.occupation).toEqual({ value: 100, unit: "percent" });
  });

  it("REP-001: computeKpiSet sur file vide → toutes valeurs null (nps null, jamais 0)", () => {
    const kpis = computeKpiSet(emptyAggregate());
    expect(kpis.tma.value).toBeNull();
    expect(kpis.tmt.value).toBeNull();
    expect(kpis.tts.value).toBeNull();
    expect(kpis.tauxAbandon.value).toBeNull();
    expect(kpis.tauxSLA.value).toBeNull();
    expect(kpis.nps).toBeNull();
    expect(kpis.occupation.value).toBeNull();
  });
});

describe("REP-001: sla-engine — fuseau Africa/Abidjan (toAbidjanDay)", () => {
  it("REP-001: constante ABIDJAN_TZ centralisée = Africa/Abidjan (jamais UTC en dur)", () => {
    expect(ABIDJAN_TZ).toBe("Africa/Abidjan");
  });

  it("REP-001: ticket émis 23h30 UTC rattaché au bon jour civil Abidjan (UTC+00)", () => {
    // Abidjan = UTC+00 toute l'année → 2026-07-01T23:30Z = jour 2026-07-01
    expect(toAbidjanDay(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-01");
  });

  it("REP-001: minuit UTC = même jour civil Abidjan", () => {
    expect(toAbidjanDay(new Date("2026-07-02T00:00:00Z"))).toBe("2026-07-02");
  });

  it("REP-001: bascule de jour à 23:59:59 UTC reste le jour courant", () => {
    expect(toAbidjanDay(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
  });
});

describe("REP-001: sla-engine — partial (jour figé à J+2 07:00 Abidjan, horloge injectée)", () => {
  it("REP-001: jour courant → partial:true", () => {
    // day = 2026-07-12, now = 2026-07-12T10:00Z → non figé
    const now = new Date("2026-07-12T10:00:00Z");
    expect(isDayPartial("2026-07-12", now)).toBe(true);
  });

  it("REP-001: jour J avant J+2 07:00 Abidjan → partial:true", () => {
    // day = 2026-07-10, figé à 2026-07-12T07:00 ; now = 2026-07-12T06:59Z → encore partiel
    const now = new Date("2026-07-12T06:59:00Z");
    expect(isDayPartial("2026-07-10", now)).toBe(true);
  });

  it("REP-001: jour J à J+2 07:00 Abidjan pile → figé (partial:false)", () => {
    const now = new Date("2026-07-12T07:00:00Z");
    expect(isDayPartial("2026-07-10", now)).toBe(false);
  });

  it("REP-001: jour clos ancien → partial:false", () => {
    const now = new Date("2026-07-13T09:00:00Z");
    expect(isDayPartial("2026-07-01", now)).toBe(false);
  });

  it("REP-001: partial est déterministe pour une horloge donnée (aucune horloge cachée)", () => {
    const now = new Date("2026-07-12T07:00:00Z");
    expect(isDayPartial("2026-07-10", now)).toBe(isDayPartial("2026-07-10", now));
  });
});

describe("REP-001: sla-engine — isolation (déterminisme, aucune I/O ni horloge cachée)", () => {
  it("REP-001: appels répétés → résultats identiques (fonctions pures)", () => {
    expect(computeKpiSet(FIXTURE)).toEqual(computeKpiSet(FIXTURE));
    expect(tma(FIXTURE)).toBe(tma(FIXTURE));
  });

  it("REP-001: l'agrégat d'entrée n'est jamais muté par le moteur", () => {
    const snapshot = JSON.parse(JSON.stringify(FIXTURE)) as DailyStatsAggregate;
    computeKpiSet(FIXTURE);
    sumAggregates([FIXTURE, FIXTURE]);
    expect(FIXTURE).toEqual(snapshot);
  });
});
