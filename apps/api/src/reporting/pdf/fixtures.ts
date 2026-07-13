/**
 * REP-002b — Fixtures de test PARTAGÉES pour les gabarits PDF (déterministes).
 *
 * Fournit des `ReportPayload` reproductibles (KpiSet fixés à la main — aucun calcul,
 * aucune horloge) pour les tests de rendu, de theming et de snapshot. Un helper
 * produit un payload avec KPIs `null` pour la règle « N/A ».
 *
 * @module
 */

import type { KpiSet } from "src/reporting/sla-engine.js";
import type { ReportPayload, ReportType } from "src/reporting/report-schedule.js";

/** KpiSet nominal fixe (durées en secondes côté moteur) — déterministe. */
export const NOMINAL_KPIS: KpiSet = {
  tma: { value: 240, unit: "minutes" },
  tmt: { value: 180, unit: "minutes" },
  tts: { value: 420, unit: "minutes" },
  tauxAbandon: { value: 4.2, unit: "percent" },
  tauxSLA: { value: 92.5, unit: "percent" },
  nps: 47,
  occupation: { value: 78.3, unit: "percent" },
};

/** KpiSet entièrement `null` (période sans données) — pour la règle « N/A ». */
export const NULL_KPIS: KpiSet = {
  tma: { value: null, unit: "minutes" },
  tmt: { value: null, unit: "minutes" },
  tts: { value: null, unit: "minutes" },
  tauxAbandon: { value: null, unit: "percent" },
  tauxSLA: { value: null, unit: "percent" },
  nps: null,
  occupation: { value: null, unit: "percent" },
};

/** Construit un `ReportPayload` déterministe pour un type donné (portée par défaut). */
export function makePayload(
  reportType: ReportType,
  overrides: Partial<ReportPayload> = {}
): ReportPayload {
  const scope = reportType === "DAILY" ? "agency" : "network";
  const base: ReportPayload = {
    bankId: "bank-abidjan-01",
    reportType,
    scope,
    agencyId: scope === "agency" ? "agency-plateau" : null,
    periodKey:
      reportType === "DAILY"
        ? "2026-07-12"
        : reportType === "WEEKLY"
          ? "2026-W28"
          : "2026-07",
    dayStart: "2026-07-01",
    dayEnd: "2026-07-31",
    partial: reportType === "DAILY",
    kpis: NOMINAL_KPIS,
    totalTickets: 1240,
    agencyCount: scope === "network" ? 12 : 1,
  };
  return { ...base, ...overrides };
}
