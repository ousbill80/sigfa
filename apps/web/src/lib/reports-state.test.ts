/**
 * Tests for reports-state (REP-003b) — pure helpers: job phases, URL expiry,
 * server-status → token mapping (zero client re-categorisation), n/a relegation.
 * @module lib/reports-state.test
 */
import { describe, it, expect } from "vitest";
import {
  EXPORT_FORMATS,
  EXPORT_SCOPES,
  SORT_KPIS,
  isJobInFlight,
  isDownloadExpired,
  canDownload,
  statusToken,
  statusLabelKey,
  orderBenchmarkRows,
  exportStatusLabelKey,
  sortKpiLabelKey,
  exportFormatLabelKey,
  exportScopeLabelKey,
  type BenchmarkRow,
} from "./reports-state";

const NOW = Date.parse("2026-07-13T10:00:00Z");

describe("REP-003b: constantes contrat", () => {
  it("REP-003b: 3 formats d'export (pdf/xlsx/json)", () => {
    expect([...EXPORT_FORMATS]).toEqual(["pdf", "xlsx", "json"]);
  });
  it("REP-003b: 2 scopes (agency/network)", () => {
    expect([...EXPORT_SCOPES]).toEqual(["agency", "network"]);
  });
  it("REP-003b: sortKpi couvre l'enum CONTRACT-013", () => {
    expect([...SORT_KPIS]).toEqual(["tauxSLA", "tma", "tmt", "tts", "tauxAbandon", "nps", "occupation"]);
  });
});

describe("REP-003b: phases du job d'export", () => {
  it("REP-003b: PENDING et PROCESSING → in-flight (poll continue)", () => {
    expect(isJobInFlight("PENDING")).toBe(true);
    expect(isJobInFlight("PROCESSING")).toBe(true);
  });
  it("REP-003b: READY et FAILED → plus in-flight (poll s'arrête)", () => {
    expect(isJobInFlight("READY")).toBe(false);
    expect(isJobInFlight("FAILED")).toBe(false);
  });
});

describe("REP-003b: expiration de l'URL signée", () => {
  it("REP-003b: expiresAt dans le passé → expiré", () => {
    expect(isDownloadExpired("2026-07-13T09:00:00Z", NOW)).toBe(true);
  });
  it("REP-003b: expiresAt dans le futur → non expiré", () => {
    expect(isDownloadExpired("2026-07-13T11:00:00Z", NOW)).toBe(false);
  });
  it("REP-003b: expiresAt absent → non expiré (le serveur possède la fraîcheur)", () => {
    expect(isDownloadExpired(null, NOW)).toBe(false);
    expect(isDownloadExpired(undefined, NOW)).toBe(false);
  });
  it("REP-003b: expiresAt malformé → non expiré (pas de faux positif)", () => {
    expect(isDownloadExpired("pas-une-date", NOW)).toBe(false);
  });
});

describe("REP-003b: canDownload (READY + URL + non expiré)", () => {
  it("REP-003b: READY + URL + non expiré → téléchargeable", () => {
    expect(canDownload("READY", "https://s/exp.pdf?sig=a", "2026-07-13T11:00:00Z", NOW)).toBe(true);
  });
  it("REP-003b: READY mais URL expirée → relance (pas de lien mort)", () => {
    expect(canDownload("READY", "https://s/exp.pdf?sig=a", "2026-07-13T09:00:00Z", NOW)).toBe(false);
  });
  it("REP-003b: READY sans URL → pas téléchargeable", () => {
    expect(canDownload("READY", null, "2026-07-13T11:00:00Z", NOW)).toBe(false);
  });
  it("REP-003b: PROCESSING → jamais téléchargeable", () => {
    expect(canDownload("PROCESSING", "https://s/exp.pdf", "2026-07-13T11:00:00Z", NOW)).toBe(false);
  });
});

describe("REP-003b: statut serveur → token (zéro re-catégorisation client)", () => {
  it("REP-003b: VERT → --success", () => {
    expect(statusToken("VERT")).toBe("var(--success)");
  });
  it("REP-003b: ORANGE → --warning", () => {
    expect(statusToken("ORANGE")).toBe("var(--warning)");
  });
  it("REP-003b: ROUGE → --danger (réservé aux alertes réelles)", () => {
    expect(statusToken("ROUGE")).toBe("var(--danger)");
  });
  it("REP-003b: n/a → --info neutre, JAMAIS --danger", () => {
    expect(statusToken("n/a")).toBe("var(--info)");
    expect(statusToken("n/a")).not.toBe("var(--danger)");
  });
});

describe("REP-003b: clés i18n de statut", () => {
  it("REP-003b: chaque statut a sa clé label", () => {
    expect(statusLabelKey("VERT")).toBe("reports.benchmark.status.vert");
    expect(statusLabelKey("ORANGE")).toBe("reports.benchmark.status.orange");
    expect(statusLabelKey("ROUGE")).toBe("reports.benchmark.status.rouge");
    expect(statusLabelKey("n/a")).toBe("reports.benchmark.status.na");
  });
  it("REP-003b: clés label export/kpi/scope dérivées", () => {
    expect(exportStatusLabelKey("READY")).toBe("reports.export.status.ready");
    expect(sortKpiLabelKey("nps")).toBe("reports.kpi.nps");
    expect(exportFormatLabelKey("pdf")).toBe("reports.export.format.pdf");
    expect(exportScopeLabelKey("network")).toBe("reports.export.scope.network");
  });
});

describe("REP-003b: ordre du classement — n/a relégué en fin", () => {
  const rows: BenchmarkRow[] = [
    { rank: 2, agencyId: "b", agencyName: "B", status: "ORANGE", tauxSLA: 71, tma: 18 },
    { rank: 1, agencyId: "a", agencyName: "A", status: "VERT", tauxSLA: 92, tma: 9 },
    { rank: 99, agencyId: "z", agencyName: "Z", status: "n/a", tauxSLA: 0, tma: 0 },
    { rank: 3, agencyId: "c", agencyName: "C", status: "ROUGE", tauxSLA: 52, tma: 28 },
  ];

  it("REP-003b: agences classées triées par rang serveur, n/a toujours en fin", () => {
    const ordered = orderBenchmarkRows(rows);
    expect(ordered.map((r) => r.agencyId)).toEqual(["a", "b", "c", "z"]);
    expect(ordered.at(-1)?.status).toBe("n/a");
  });

  it("REP-003b: n/a avec un rang bas reste en fin (jamais classé rouge)", () => {
    const ordered = orderBenchmarkRows([
      { rank: 1, agencyId: "na", agencyName: "NA", status: "n/a", tauxSLA: 0, tma: 0 },
      { rank: 2, agencyId: "ok", agencyName: "OK", status: "VERT", tauxSLA: 90, tma: 8 },
    ]);
    expect(ordered.map((r) => r.agencyId)).toEqual(["ok", "na"]);
  });

  it("REP-003b: entrée d'origine non mutée", () => {
    const snapshot = rows.map((r) => r.agencyId);
    orderBenchmarkRows(rows);
    expect(rows.map((r) => r.agencyId)).toEqual(snapshot);
  });
});
