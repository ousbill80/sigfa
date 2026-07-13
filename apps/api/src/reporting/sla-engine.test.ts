/**
 * Tests unitaires — REP-001 : moteur d'agrégats KPI (`sla-engine`).
 *
 * Fonctions PURES et déterministes : aucun I/O, horloge injectée. Ces tests
 * ciblent la QUALITÉ (mutation testing SEC-005) — chaque assertion tue un
 * mutant précis (frontières, opérateurs, arrondis, div0, plafonds, fuseau).
 *
 * Nommage : `SEC-005/REP-001: <description>`
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  ABIDJAN_TZ,
  tma,
  tmt,
  tts,
  tauxAbandon,
  tauxSla,
  nps,
  occupation,
  computeKpiSet,
  emptyAggregate,
  sumAggregates,
  toAbidjanDay,
  isDayPartial,
  type DailyStatsAggregate,
} from "src/reporting/sla-engine.js";

/** Agrégat de base : construit à partir du neutre + overrides ciblés. */
function agg(over: Partial<DailyStatsAggregate> = {}): DailyStatsAggregate {
  return { ...emptyAggregate(), ...over };
}

// ── Constante de fuseau ──────────────────────────────────────────────────────

describe("SEC-005/REP-001: fuseau de référence", () => {
  it("SEC-005/REP-001: ABIDJAN_TZ vaut exactement 'Africa/Abidjan'", () => {
    expect(ABIDJAN_TZ).toBe("Africa/Abidjan");
  });
});

// ── TMA — total_wait_seconds / served_count (arrondi 0 déc.) ─────────────────

describe("SEC-005/REP-001: TMA (attente moyenne, secondes)", () => {
  it("SEC-005/REP-001: TMA = total_wait / served, arrondi au plus proche", () => {
    // 1000 / 3 = 333.33… → arrondi 333
    expect(tma(agg({ totalWaitSeconds: 1000, servedCount: 3 }))).toBe(333);
  });

  it("SEC-005/REP-001: TMA arrondit le demi vers le haut (0.5 → 1)", () => {
    // 3 / 2 = 1.5 → 2 (round half up)
    expect(tma(agg({ totalWaitSeconds: 3, servedCount: 2 }))).toBe(2);
  });

  it("SEC-005/REP-001: TMA exact sans reste", () => {
    expect(tma(agg({ totalWaitSeconds: 600, servedCount: 4 }))).toBe(150);
  });

  it("SEC-005/REP-001: TMA = null si servedCount = 0 (jamais 0/NaN)", () => {
    expect(tma(agg({ totalWaitSeconds: 500, servedCount: 0 }))).toBeNull();
  });

  it("SEC-005/REP-001: TMA = null si servedCount négatif (denominator <= 0)", () => {
    expect(tma(agg({ totalWaitSeconds: 500, servedCount: -1 }))).toBeNull();
  });

  it("SEC-005/REP-001: TMA = 0 si attente nulle mais servedCount > 0 (pas null)", () => {
    expect(tma(agg({ totalWaitSeconds: 0, servedCount: 5 }))).toBe(0);
  });
});

// ── TMT — total_service_seconds / done_count ─────────────────────────────────

describe("SEC-005/REP-001: TMT (traitement moyen, DONE only)", () => {
  it("SEC-005/REP-001: TMT = total_service / done, arrondi", () => {
    expect(tmt(agg({ totalServiceSeconds: 1000, doneCount: 3 }))).toBe(333);
  });

  it("SEC-005/REP-001: TMT arrondit le demi vers le haut", () => {
    expect(tmt(agg({ totalServiceSeconds: 5, doneCount: 2 }))).toBe(3);
  });

  it("SEC-005/REP-001: TMT = null si doneCount = 0", () => {
    expect(tmt(agg({ totalServiceSeconds: 900, doneCount: 0 }))).toBeNull();
  });

  it("SEC-005/REP-001: TMT distinct de TMA (utilise service, pas wait)", () => {
    const a = agg({
      totalWaitSeconds: 100,
      servedCount: 1,
      totalServiceSeconds: 800,
      doneCount: 4,
    });
    expect(tmt(a)).toBe(200);
    expect(tma(a)).toBe(100);
  });
});

// ── TTS — TMA + TMT ──────────────────────────────────────────────────────────

describe("SEC-005/REP-001: TTS (temps total = TMA + TMT)", () => {
  it("SEC-005/REP-001: TTS = TMA + TMT quand les deux existent", () => {
    const a = agg({
      totalWaitSeconds: 300,
      servedCount: 3, // TMA = 100
      totalServiceSeconds: 800,
      doneCount: 4, // TMT = 200
    });
    expect(tts(a)).toBe(300);
  });

  it("SEC-005/REP-001: TTS = null si TMA null (served = 0)", () => {
    const a = agg({ totalServiceSeconds: 800, doneCount: 4 }); // TMA null
    expect(tts(a)).toBeNull();
  });

  it("SEC-005/REP-001: TTS = null si TMT null (done = 0)", () => {
    const a = agg({ totalWaitSeconds: 300, servedCount: 3 }); // TMT null
    expect(tts(a)).toBeNull();
  });

  it("SEC-005/REP-001: TTS = null si les deux null", () => {
    expect(tts(agg())).toBeNull();
  });
});

// ── Taux d'abandon — abandoned / (abandoned + served) × 100 (NO_SHOW exclu) ──

describe("SEC-005/REP-001: taux d'abandon (%, 2 déc., NO_SHOW exclu)", () => {
  it("SEC-005/REP-001: abandon = abandoned / (abandoned + served) × 100", () => {
    // 15 / (15 + 85) = 15%
    expect(tauxAbandon(agg({ abandonedCount: 15, servedCount: 85 }))).toBe(15);
  });

  it("SEC-005/REP-001: abandon arrondi à 2 décimales", () => {
    // 1 / 3 = 0.3333… → ×100 = 33.33
    expect(tauxAbandon(agg({ abandonedCount: 1, servedCount: 2 }))).toBe(33.33);
  });

  it("SEC-005/REP-001: NO_SHOW n'affecte PAS le taux d'abandon", () => {
    const base = agg({ abandonedCount: 10, servedCount: 10 });
    const withNoShow = agg({ abandonedCount: 10, servedCount: 10, noShowCount: 50 });
    expect(tauxAbandon(base)).toBe(50);
    expect(tauxAbandon(withNoShow)).toBe(50);
  });

  it("SEC-005/REP-001: abandon = null si abandoned + served = 0", () => {
    expect(tauxAbandon(agg({ noShowCount: 10 }))).toBeNull();
  });

  it("SEC-005/REP-001: abandon = 0 (pas null) si aucun abandon mais des servis", () => {
    expect(tauxAbandon(agg({ abandonedCount: 0, servedCount: 20 }))).toBe(0);
  });
});

// ── Taux SLA — sla_met / sla_total × 100 ─────────────────────────────────────

describe("SEC-005/REP-001: taux SLA (%, 2 déc.)", () => {
  it("SEC-005/REP-001: SLA = met / total × 100", () => {
    expect(tauxSla(agg({ slaMetCount: 70, slaTotalCount: 100 }))).toBe(70);
  });

  it("SEC-005/REP-001: SLA arrondi 2 décimales", () => {
    // 2 / 3 = 0.6666… → 66.67
    expect(tauxSla(agg({ slaMetCount: 2, slaTotalCount: 3 }))).toBe(66.67);
  });

  it("SEC-005/REP-001: SLA = null si slaTotalCount = 0", () => {
    expect(tauxSla(agg({ slaMetCount: 0, slaTotalCount: 0 }))).toBeNull();
  });

  it("SEC-005/REP-001: SLA = 100 si tout respecté", () => {
    expect(tauxSla(agg({ slaMetCount: 40, slaTotalCount: 40 }))).toBe(100);
  });
});

// ── NPS — (promoters − detractors) / feedback × 100, entier [−100..+100] ─────

describe("SEC-005/REP-001: NPS (score entier [−100..+100])", () => {
  it("SEC-005/REP-001: NPS = (promoters − detractors) / feedback × 100", () => {
    // (30 − 5) / 40 = 0.625 → 62.5 → arrondi 63 (half up)
    expect(nps(agg({ npsPromoters: 30, npsDetractors: 5, feedbackCount: 40 }))).toBe(63);
  });

  it("SEC-005/REP-001: NPS négatif si détracteurs majoritaires", () => {
    // (5 − 30) / 40 = −0.625 → −62.5 → −62 (round half up: -62.5 rounds to -62)
    expect(nps(agg({ npsPromoters: 5, npsDetractors: 30, feedbackCount: 40 }))).toBe(-62);
  });

  it("SEC-005/REP-001: NPS = 100 si tous promoteurs", () => {
    expect(nps(agg({ npsPromoters: 10, npsDetractors: 0, feedbackCount: 10 }))).toBe(100);
  });

  it("SEC-005/REP-001: NPS = -100 si tous détracteurs", () => {
    expect(nps(agg({ npsPromoters: 0, npsDetractors: 10, feedbackCount: 10 }))).toBe(-100);
  });

  it("SEC-005/REP-001: NPS = 0 si promoteurs = détracteurs", () => {
    expect(nps(agg({ npsPromoters: 5, npsDetractors: 5, feedbackCount: 20 }))).toBe(0);
  });

  it("SEC-005/REP-001: NPS = null si feedbackCount = 0 (jamais 0 fallacieux)", () => {
    expect(nps(agg({ npsPromoters: 3, npsDetractors: 1, feedbackCount: 0 }))).toBeNull();
  });

  it("SEC-005/REP-001: NPS ignore les passifs (ni promo ni détracteur)", () => {
    // passives=100 ne change pas (30-5)/40 mais est dans feedback? feedbackCount explicite
    expect(
      nps(agg({ npsPromoters: 6, npsPassives: 4, npsDetractors: 0, feedbackCount: 10 }))
    ).toBe(60);
  });
});

// ── Occupation — active / available × 100, plafond 100 ───────────────────────

describe("SEC-005/REP-001: occupation (%, 2 déc., plafond 100)", () => {
  it("SEC-005/REP-001: occupation = active / available × 100", () => {
    expect(occupation(agg({ agentActiveSeconds: 3600, agentAvailableSeconds: 7200 }))).toBe(50);
  });

  it("SEC-005/REP-001: occupation arrondie 2 décimales", () => {
    // 1 / 3 = 0.3333 → 33.33
    expect(occupation(agg({ agentActiveSeconds: 1, agentAvailableSeconds: 3 }))).toBe(33.33);
  });

  it("SEC-005/REP-001: occupation plafonnée à 100 (active > available)", () => {
    expect(occupation(agg({ agentActiveSeconds: 9000, agentAvailableSeconds: 3600 }))).toBe(100);
  });

  it("SEC-005/REP-001: occupation = 100 pile quand active = available", () => {
    expect(occupation(agg({ agentActiveSeconds: 3600, agentAvailableSeconds: 3600 }))).toBe(100);
  });

  it("SEC-005/REP-001: occupation = null si available null (aucune donnée)", () => {
    expect(occupation(agg({ agentActiveSeconds: 100, agentAvailableSeconds: null }))).toBeNull();
  });

  it("SEC-005/REP-001: occupation = null si available = 0", () => {
    expect(occupation(agg({ agentActiveSeconds: 100, agentAvailableSeconds: 0 }))).toBeNull();
  });

  it("SEC-005/REP-001: occupation = 0 si active null mais available présent", () => {
    expect(occupation(agg({ agentActiveSeconds: null, agentAvailableSeconds: 7200 }))).toBe(0);
  });
});

// ── computeKpiSet — assemblage contractuel des 7 KPIs ───────────────────────

describe("SEC-005/REP-001: computeKpiSet (KpiSet contractuel)", () => {
  const full = agg({
    totalWaitSeconds: 300,
    servedCount: 3, // TMA 100
    totalServiceSeconds: 800,
    doneCount: 4, // TMT 200
    abandonedCount: 10,
    slaMetCount: 8,
    slaTotalCount: 10,
    feedbackCount: 10,
    npsPromoters: 7,
    npsDetractors: 2,
    agentActiveSeconds: 1800,
    agentAvailableSeconds: 3600,
  });

  it("SEC-005/REP-001: valeurs KPI cohérentes avec les fonctions pures", () => {
    const k = computeKpiSet(full);
    expect(k.tma.value).toBe(100);
    expect(k.tmt.value).toBe(200);
    expect(k.tts.value).toBe(300);
    // abandon = 10 / (10 + 3) = 76.92
    expect(k.tauxAbandon.value).toBe(76.92);
    expect(k.tauxSLA.value).toBe(80);
    // nps = (7 - 2) / 10 × 100 = 50
    expect(k.nps).toBe(50);
    expect(k.occupation.value).toBe(50);
  });

  it("SEC-005/REP-001: unités contractuelles exactes par KPI", () => {
    const k = computeKpiSet(full);
    expect(k.tma.unit).toBe("minutes");
    expect(k.tmt.unit).toBe("minutes");
    expect(k.tts.unit).toBe("minutes");
    expect(k.tauxAbandon.unit).toBe("percent");
    expect(k.tauxSLA.unit).toBe("percent");
    expect(k.occupation.unit).toBe("percent");
  });

  it("SEC-005/REP-001: nps est un scalaire nullable (pas un KpiValue)", () => {
    const k = computeKpiSet(agg());
    expect(k.nps).toBeNull();
  });

  it("SEC-005/REP-001: agrégat vide → tous KPIs null", () => {
    const k = computeKpiSet(emptyAggregate());
    expect(k.tma.value).toBeNull();
    expect(k.tmt.value).toBeNull();
    expect(k.tts.value).toBeNull();
    expect(k.tauxAbandon.value).toBeNull();
    expect(k.tauxSLA.value).toBeNull();
    expect(k.nps).toBeNull();
    expect(k.occupation.value).toBeNull();
  });
});

// ── emptyAggregate — neutre ─────────────────────────────────────────────────

describe("SEC-005/REP-001: emptyAggregate (neutre)", () => {
  it("SEC-005/REP-001: tous les comptages à 0", () => {
    const e = emptyAggregate();
    expect(e.ticketsIssued).toBe(0);
    expect(e.servedCount).toBe(0);
    expect(e.doneCount).toBe(0);
    expect(e.abandonedCount).toBe(0);
    expect(e.noShowCount).toBe(0);
    expect(e.totalWaitSeconds).toBe(0);
    expect(e.totalServiceSeconds).toBe(0);
    expect(e.slaMetCount).toBe(0);
    expect(e.slaTotalCount).toBe(0);
    expect(e.feedbackCount).toBe(0);
    expect(e.npsPromoters).toBe(0);
    expect(e.npsPassives).toBe(0);
    expect(e.npsDetractors).toBe(0);
  });

  it("SEC-005/REP-001: occupation active/available inconnus → null", () => {
    const e = emptyAggregate();
    expect(e.agentActiveSeconds).toBeNull();
    expect(e.agentAvailableSeconds).toBeNull();
  });
});

// ── sumAggregates — somme des mesures brutes (jamais moyenne de moyennes) ─────

describe("SEC-005/REP-001: sumAggregates (agrégation multi-jours)", () => {
  it("SEC-005/REP-001: somme mesure par mesure", () => {
    const a = agg({
      ticketsIssued: 10,
      servedCount: 8,
      doneCount: 6,
      abandonedCount: 2,
      noShowCount: 1,
      totalWaitSeconds: 100,
      totalServiceSeconds: 200,
      slaMetCount: 5,
      slaTotalCount: 7,
      feedbackCount: 4,
      npsPromoters: 3,
      npsPassives: 1,
      npsDetractors: 0,
    });
    const b = agg({
      ticketsIssued: 20,
      servedCount: 12,
      doneCount: 9,
      abandonedCount: 3,
      noShowCount: 2,
      totalWaitSeconds: 400,
      totalServiceSeconds: 500,
      slaMetCount: 6,
      slaTotalCount: 8,
      feedbackCount: 6,
      npsPromoters: 4,
      npsPassives: 1,
      npsDetractors: 1,
    });
    const s = sumAggregates([a, b]);
    expect(s.ticketsIssued).toBe(30);
    expect(s.servedCount).toBe(20);
    expect(s.doneCount).toBe(15);
    expect(s.abandonedCount).toBe(5);
    expect(s.noShowCount).toBe(3);
    expect(s.totalWaitSeconds).toBe(500);
    expect(s.totalServiceSeconds).toBe(700);
    expect(s.slaMetCount).toBe(11);
    expect(s.slaTotalCount).toBe(15);
    expect(s.feedbackCount).toBe(10);
    expect(s.npsPromoters).toBe(7);
    expect(s.npsPassives).toBe(2);
    expect(s.npsDetractors).toBe(1);
  });

  it("SEC-005/REP-001: liste vide → agrégat neutre", () => {
    expect(sumAggregates([])).toEqual(emptyAggregate());
  });

  it("SEC-005/REP-001: occupation — deux null → reste null", () => {
    const s = sumAggregates([agg(), agg()]);
    expect(s.agentActiveSeconds).toBeNull();
    expect(s.agentAvailableSeconds).toBeNull();
  });

  it("SEC-005/REP-001: occupation — un null + un nombre → somme (null compte 0)", () => {
    const s = sumAggregates([
      agg({ agentActiveSeconds: null, agentAvailableSeconds: null }),
      agg({ agentActiveSeconds: 1000, agentAvailableSeconds: 2000 }),
    ]);
    expect(s.agentActiveSeconds).toBe(1000);
    expect(s.agentAvailableSeconds).toBe(2000);
  });

  it("SEC-005/REP-001: occupation — left=null seul (right nombre) → 0+right, PAS null", () => {
    // addNullable(null, 500) : le && exige LES DEUX null pour rester null.
    // Mutant `left !== null` ou `||` renverrait null ici → ce test le tue.
    const s = sumAggregates([
      agg({ agentActiveSeconds: null }),
      agg({ agentActiveSeconds: 500 }),
    ]);
    expect(s.agentActiveSeconds).toBe(500);
    expect(s.agentActiveSeconds).not.toBeNull();
  });

  it("SEC-005/REP-001: occupation — right=null seul (left nombre) → left+0, PAS null", () => {
    const s = sumAggregates([
      agg({ agentActiveSeconds: 700 }),
      agg({ agentActiveSeconds: null }),
    ]);
    expect(s.agentActiveSeconds).toBe(700);
  });

  it("SEC-005/REP-001: occupation — deux null STRICTS (une seule paire) → null", () => {
    // Une seule addition null+null (liste à 1 élément null) : isole addNullable(null,null).
    const s = sumAggregates([agg({ agentActiveSeconds: null, agentAvailableSeconds: null })]);
    expect(s.agentActiveSeconds).toBeNull();
    expect(s.agentAvailableSeconds).toBeNull();
  });

  it("SEC-005/REP-001: occupation — deux nombres → somme", () => {
    const s = sumAggregates([
      agg({ agentActiveSeconds: 300, agentAvailableSeconds: 600 }),
      agg({ agentActiveSeconds: 700, agentAvailableSeconds: 900 }),
    ]);
    expect(s.agentActiveSeconds).toBe(1000);
    expect(s.agentAvailableSeconds).toBe(1500);
  });

  it("SEC-005/REP-001: ne mute pas les entrées (immutabilité)", () => {
    const a = agg({ ticketsIssued: 5 });
    const b = agg({ ticketsIssued: 7 });
    sumAggregates([a, b]);
    expect(a.ticketsIssued).toBe(5);
    expect(b.ticketsIssued).toBe(7);
  });

  it("SEC-005/REP-001: multi-jours — moyenne recalculée depuis les sommes (pas moyenne de moyennes)", () => {
    // Jour 1 : TMA = 100/1 = 100 ; Jour 2 : TMA = 900/1 = 900
    // Moyenne de moyennes (FAUX) = 500 ; somme correcte = 1000/2 = 500 ici égaux,
    // on force l'asymétrie : jour 2 a 3 servis.
    const day1 = agg({ totalWaitSeconds: 100, servedCount: 1 }); // TMA 100
    const day2 = agg({ totalWaitSeconds: 900, servedCount: 3 }); // TMA 300
    const summed = sumAggregates([day1, day2]);
    // somme correcte = 1000 / 4 = 250 (≠ moyenne de moyennes (100+300)/2 = 200)
    expect(tma(summed)).toBe(250);
  });
});

// ── toAbidjanDay — conversion fuseau ─────────────────────────────────────────

describe("SEC-005/REP-001: toAbidjanDay (jour civil Abidjan)", () => {
  it("SEC-005/REP-001: instant UTC en plein jour → jour civil correct", () => {
    expect(toAbidjanDay(new Date("2026-07-12T12:00:00Z"))).toBe("2026-07-12");
  });

  it("SEC-005/REP-001: format exact YYYY-MM-DD (année, mois ET jour présents)", () => {
    // Date où année/mois/jour sont tous distincts et à 2 chiffres significatifs :
    // tue les mutants qui suppriment une des 3 composantes du formateur Intl
    // (year → '07-12', month → '2026 (day: 12)', day → '2026-07').
    const out = toAbidjanDay(new Date("2026-11-23T08:30:00Z"));
    expect(out).toBe("2026-11-23");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [y, m, d] = out.split("-");
    expect(y).toBe("2026"); // composante année présente
    expect(m).toBe("11"); // composante mois présente
    expect(d).toBe("23"); // composante jour présente
  });

  it("SEC-005/REP-001: mois et jour à un chiffre → padding 2-digit (05, 03)", () => {
    // Force month=03, day=05 : distingue '2-digit' de 'numeric' et confirme les 3 champs.
    expect(toAbidjanDay(new Date("2026-03-05T10:00:00Z"))).toBe("2026-03-05");
  });

  it("SEC-005/REP-001: minuit UTC = même jour (Abidjan UTC+0)", () => {
    expect(toAbidjanDay(new Date("2026-07-12T00:00:00Z"))).toBe("2026-07-12");
  });

  it("SEC-005/REP-001: 23:59 UTC reste dans le jour (Abidjan UTC+0)", () => {
    expect(toAbidjanDay(new Date("2026-07-12T23:59:59Z"))).toBe("2026-07-12");
  });
});

// ── isDayPartial — figeage à J+2 07:00 Abidjan ──────────────────────────────

describe("SEC-005/REP-001: isDayPartial (figé à J+2 07:00 Abidjan)", () => {
  const DAY = "2026-07-12";
  // Instant de figeage = 2026-07-14T07:00:00Z (Abidjan UTC+0).

  it("SEC-005/REP-001: partiel juste avant le figeage (J+2 06:59)", () => {
    expect(isDayPartial(DAY, new Date("2026-07-14T06:59:59Z"))).toBe(true);
  });

  it("SEC-005/REP-001: figé pile à J+2 07:00 (frontière stricte <)", () => {
    expect(isDayPartial(DAY, new Date("2026-07-14T07:00:00Z"))).toBe(false);
  });

  it("SEC-005/REP-001: figé juste après le figeage (J+2 07:00:01)", () => {
    expect(isDayPartial(DAY, new Date("2026-07-14T07:00:01Z"))).toBe(false);
  });

  it("SEC-005/REP-001: partiel le jour même", () => {
    expect(isDayPartial(DAY, new Date("2026-07-12T12:00:00Z"))).toBe(true);
  });

  it("SEC-005/REP-001: partiel à J+1 (pas encore J+2)", () => {
    expect(isDayPartial(DAY, new Date("2026-07-13T23:00:00Z"))).toBe(true);
  });

  it("SEC-005/REP-001: figé longtemps après", () => {
    expect(isDayPartial(DAY, new Date("2026-08-01T00:00:00Z"))).toBe(false);
  });
});
