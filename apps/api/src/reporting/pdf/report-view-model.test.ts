import { describe, it, expect } from "vitest";
import {
  buildReportViewModel,
  buildKpiRows,
} from "src/reporting/pdf/report-view-model.js";
import { pdfStrings } from "src/reporting/pdf/pdf-i18n.js";
import { makePayload, NULL_KPIS } from "src/reporting/pdf/fixtures.js";

describe("REP-002b: view-model d'affichage (formatage pur, zéro recalcul)", () => {
  it("REP-002b: convertit les durées moteur (secondes) en minutes affichées", () => {
    const rows = buildKpiRows(makePayload("DAILY").kpis, pdfStrings("FR"));
    const tma = rows.find((r) => r.key === "tma");
    // 240 s → 4 min.
    expect(tma?.value).toBe("4 min");
  });

  it("REP-002b: KPI null → « N/A » (jamais 0, jamais vide) en FR et EN", () => {
    for (const lang of ["FR", "EN"] as const) {
      const payload = makePayload("MONTHLY", { kpis: NULL_KPIS });
      const vm = buildReportViewModel(payload, lang);
      for (const row of vm.kpiRows) {
        expect(row.value).toBe("N/A");
      }
    }
  });

  it("REP-002b: titre localisé selon le type de rapport (FR)", () => {
    expect(buildReportViewModel(makePayload("DAILY"), "FR").title).toBe(
      "Rapport journalier"
    );
    expect(buildReportViewModel(makePayload("WEEKLY"), "FR").title).toBe(
      "Rapport hebdomadaire réseau"
    );
    expect(buildReportViewModel(makePayload("MONTHLY"), "FR").title).toBe(
      "Rapport mensuel qualité"
    );
  });

  it("REP-002b: portée réseau affiche « Réseau » et l'agrégat d'agences", () => {
    const vm = buildReportViewModel(makePayload("WEEKLY"), "FR");
    expect(vm.scopeLabel).toBe("Réseau");
    expect(vm.agencyCount).toBe("12");
  });

  it("REP-002b: COMEX met en avant 3 KPIs stratégiques (SLA, NPS, abandon)", () => {
    const vm = buildReportViewModel(makePayload("MONTHLY"), "FR");
    expect(vm.comexHighlights).toHaveLength(3);
    expect(vm.comexHighlights.map((r) => r.key)).toEqual([
      "tauxSLA",
      "nps",
      "tauxAbandon",
    ]);
  });

  it("REP-002b: taux/NPS formatés avec unité (déterministe)", () => {
    const vm = buildReportViewModel(makePayload("DAILY"), "FR");
    const byKey = (k: string) => vm.kpiRows.find((r) => r.key === k)?.value;
    expect(byKey("tauxSLA")).toBe("92.5 %");
    expect(byKey("nps")).toBe("47");
    expect(byKey("occupation")).toBe("78.3 %");
  });
});
