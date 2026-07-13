/**
 * REP-003 — Tests unitaires du benchmarking inter-agences (fonctions pures).
 * Normalisation du sens des KPI, sortKpi, statut vert/orange/rouge/n-a.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  rankAgencies,
  classifyStatus,
  normalizedScore,
  DEFAULT_THRESHOLDS,
  KPI_HIGHER_IS_BETTER,
  type AgencyBenchmarkInput,
} from "src/reporting/benchmark.js";
import { emptyAggregate, type DailyStatsAggregate } from "src/reporting/sla-engine.js";

/** Agrégat plein paramétré (SLA + attente contrôlés). */
function agg(over: Partial<DailyStatsAggregate>): DailyStatsAggregate {
  return { ...emptyAggregate(), ticketsIssued: 100, ...over };
}

/** Agrégat menant à un taux SLA donné (%) et un TMA donné (minutes). */
function aggFor(slaPct: number, tmaMin: number, served = 100): DailyStatsAggregate {
  return agg({
    servedCount: served,
    doneCount: served,
    totalWaitSeconds: Math.round(tmaMin * 60 * served),
    slaMetCount: Math.round((slaPct / 100) * served),
    slaTotalCount: served,
  });
}

describe("REP-003: classifyStatus (seuils SLA + TMA documentés)", () => {
  it("REP-003: VERT si SLA ≥ 80% ET TMA ≤ 15 min", () => {
    expect(classifyStatus(92, 9, DEFAULT_THRESHOLDS)).toBe("VERT");
  });
  it("REP-003: ORANGE entre les seuils", () => {
    expect(classifyStatus(71, 18, DEFAULT_THRESHOLDS)).toBe("ORANGE");
  });
  it("REP-003: ROUGE si SLA < 60% OU TMA > 25 min", () => {
    expect(classifyStatus(52, 28, DEFAULT_THRESHOLDS)).toBe("ROUGE");
    expect(classifyStatus(90, 30, DEFAULT_THRESHOLDS)).toBe("ROUGE");
  });
});

describe("REP-003: normalizedScore — sens normalisé par KPI", () => {
  it("REP-003: SLA/NPS/occupation → plus haut = meilleur (score inchangé)", () => {
    expect(KPI_HIGHER_IS_BETTER.tauxSLA).toBe(true);
    expect(normalizedScore("tauxSLA", 80)).toBe(80);
    expect(normalizedScore("nps", 40)).toBe(40);
  });
  it("REP-003: TMA/abandon → plus bas = meilleur (score nié)", () => {
    expect(KPI_HIGHER_IS_BETTER.tma).toBe(false);
    expect(normalizedScore("tma", 10)).toBe(-10);
    expect(normalizedScore("tauxAbandon", 5)).toBe(-5);
  });
  it("REP-003: valeur null → score null (relégué)", () => {
    expect(normalizedScore("tauxSLA", null)).toBeNull();
  });
});

describe("REP-003: rankAgencies — classement + n/a", () => {
  const inputs: AgencyBenchmarkInput[] = [
    { agencyId: "a1", agencyName: "Plateau", aggregate: aggFor(92, 9) },
    { agencyId: "a2", agencyName: "Cocody", aggregate: aggFor(71, 18) },
    { agencyId: "a3", agencyName: "Yopougon", aggregate: aggFor(52, 28) },
    { agencyId: "a4", agencyName: "Sans donnée", aggregate: null },
  ];

  it("REP-003: tri par tauxSLA (défaut) — meilleur SLA rang 1", () => {
    const ranked = rankAgencies(inputs);
    expect(ranked[0]!.agencyId).toBe("a1");
    expect(ranked[0]!.rank).toBe(1);
    expect(ranked[0]!.status).toBe("VERT");
    expect(ranked[1]!.status).toBe("ORANGE");
    expect(ranked[2]!.status).toBe("ROUGE");
  });

  it("REP-003: agence sans donnée → statut n/a, JAMAIS rouge, reléguée en fin", () => {
    const ranked = rankAgencies(inputs);
    const na = ranked.find((e) => e.agencyId === "a4")!;
    expect(na.status).toBe("n/a");
    expect(na.tauxSLA).toBeNull();
    expect(na.tma).toBeNull();
    // n/a est TOUJOURS en dernier (rang max), jamais mêlé aux classées.
    expect(na.rank).toBe(ranked.length);
  });

  it("REP-003: tri par tma normalisé (plus bas = meilleur) inverse le classement", () => {
    const ranked = rankAgencies(inputs, "tma");
    // a1 a le plus petit TMA (9) → rang 1 ; a3 (28) le pire des classées.
    expect(ranked[0]!.agencyId).toBe("a1");
    const classed = ranked.filter((e) => e.status !== "n/a");
    expect(classed[classed.length - 1]!.agencyId).toBe("a3");
  });

  it("REP-003: liste vide → classement vide", () => {
    expect(rankAgencies([])).toEqual([]);
  });
});
