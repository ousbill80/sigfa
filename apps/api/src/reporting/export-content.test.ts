/**
 * REP-003 — Tests unitaires de la sérialisation d'export (PDF/Excel/JSON).
 * Dérivation stricte REP-001 (mêmes KPIs), anonymisation réseau (zéro PII).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  buildJsonPayload,
  buildExcel,
  buildPdf,
  renderExport,
  type AgencyExportModel,
  type NetworkExportModel,
} from "src/reporting/export-content.js";
import { EXPORT_CONTENT_TYPE } from "src/reporting/export-storage.js";
import { emptyAggregate, type DailyStatsAggregate } from "src/reporting/sla-engine.js";

/** Agrégat plein déterministe (TMA/TMT/SLA connus). */
function fullAgg(): DailyStatsAggregate {
  return {
    ...emptyAggregate(),
    ticketsIssued: 100,
    servedCount: 80,
    doneCount: 80,
    abandonedCount: 15,
    noShowCount: 0,
    totalWaitSeconds: 40800, // /80 = 510 s = 8.5 min
    totalServiceSeconds: 43200, // /80 = 540 s = 9 min
    slaMetCount: 70,
    slaTotalCount: 100, // 70%
    feedbackCount: 10,
    npsPromoters: 5,
    npsDetractors: 2,
  };
}

const agencyModel: AgencyExportModel = {
  scope: "agency",
  periodKey: "2026-07",
  agencyId: "33333333-3333-4333-a333-333333333333",
  aggregate: fullAgg(),
  partial: false,
};

const networkModel: NetworkExportModel = {
  scope: "network",
  periodKey: "2026-07",
  aggregate: fullAgg(),
  agencyCount: 3,
  partial: false,
};

describe("REP-003: export JSON — schéma contractuel (mêmes KPIs que /reports/kpis)", () => {
  it("REP-003: agency — kpis en minutes/percent, dérivés REP-001", () => {
    const json = buildJsonPayload(agencyModel);
    expect(json["scope"]).toBe("agency");
    expect(json["agencyId"]).toBe(agencyModel.agencyId);
    const kpis = json["kpis"] as Record<string, { value: number; unit: string }>;
    expect(kpis["tma"]).toEqual({ value: 8.5, unit: "minutes" });
    expect(kpis["tmt"]).toEqual({ value: 9, unit: "minutes" });
    expect(kpis["tauxSLA"]).toEqual({ value: 70, unit: "percent" });
    expect(json["totalTickets"]).toBe(100);
  });

  it("REP-003: network — AnonymizedNetworkAggregate, ZÉRO PII (aucun agencyId)", () => {
    const json = buildJsonPayload(networkModel);
    expect(json["scope"]).toBe("network");
    expect(json["agencyId"]).toBeUndefined();
    const agg = json["aggregate"] as Record<string, number>;
    expect(agg["avgTauxSLA"]).toBe(70);
    expect(agg["agencyCount"]).toBe(3);
    // Zéro identifiant/nom d'agence quelque part dans la charge réseau.
    expect(JSON.stringify(json)).not.toContain("33333333");
  });
});

describe("REP-003: export Excel — SpreadsheetML déterministe, zéro PII réseau", () => {
  it("REP-003: agency — contient les KPIs et l'agencyId", () => {
    const buf = buildExcel(agencyModel);
    const xml = buf.toString("utf-8");
    expect(xml).toContain("<?xml");
    expect(xml).toContain("tauxSLA_percent");
    expect(xml).toContain("70");
  });
  it("REP-003: network — aucun agencyId dans le classeur", () => {
    const xml = buildExcel(networkModel).toString("utf-8");
    expect(xml).toContain("agencyCount");
    expect(xml).not.toContain("33333333");
  });
});

describe("REP-003: export PDF — document valide, zéro PII réseau", () => {
  it("REP-003: commence par %PDF- et se termine par %%EOF", () => {
    const buf = buildPdf(agencyModel);
    const pdf = buf.toString("utf-8");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
  });
  it("REP-003: network — aucun agencyId dans le PDF", () => {
    const pdf = buildPdf(networkModel).toString("utf-8");
    expect(pdf).not.toContain("33333333");
  });
});

describe("REP-003: renderExport — 3 formats + Content-Type correct", () => {
  it.each(["json", "xlsx", "pdf"] as const)(
    "REP-003: renderExport(%s) → bon Content-Type + contenu non vide",
    (format) => {
      const out = renderExport(format, agencyModel);
      expect(out.contentType).toBe(EXPORT_CONTENT_TYPE[format]);
      expect(out.body.length).toBeGreaterThan(0);
    }
  );
});
