/**
 * REP-003 — Tests unitaires du build d'export SANS BullMQ (logique pure) :
 * PROCESSING → rendu (dérivé REP-001) → stockage MOCK → URL signée → READY,
 * et échec de génération → FAILED (jamais de fichier corrompu servi).
 * Horloge injectée (fake-timers).
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runExportBuild,
  buildExportModel,
  exportObjectKey,
} from "src/jobs/export-build.job.js";
import { MockObjectStorage } from "src/reporting/export-storage.js";
import { encodeScope, type ExportJobRow } from "src/reporting/export-job-service.js";
import type { QueryFn } from "src/reporting/aggregate-service.js";

const NOW = new Date("2026-07-13T09:00:00Z");

/** QueryFn en mémoire : renvoie les lignes daily_agency_stats seed + capture les UPDATE. */
function makeQuery(statsRows: Array<Record<string, unknown>>): {
  query: QueryFn;
  updates: Array<{ sql: string; values: unknown[] }>;
} {
  const updates: Array<{ sql: string; values: unknown[] }> = [];
  const query: QueryFn = (sql, values) => {
    if (/^\s*SELECT/i.test(sql) && /daily_agency_stats/.test(sql)) {
      return Promise.resolve({ rows: statsRows });
    }
    updates.push({ sql, values: (values ?? []) as unknown[] });
    return Promise.resolve({ rows: [] });
  };
  return { query, updates };
}

/** Ligne d'agrégat toutes-services minimale (SLA 70%). */
function statsRow(agencyId: string): Record<string, unknown> {
  return {
    agency_id: agencyId,
    tickets_issued: 100,
    tickets_served: 80,
    tickets_abandoned: 15,
    tickets_no_show: 0,
    total_wait_seconds: 40800,
    total_service_seconds: 43200,
    sla_met_count: 70,
    sla_total_count: 100,
    feedback_count: 10,
    nps_promoters: 5,
    nps_passives: 3,
    nps_detractors: 2,
    agent_active_seconds: 3600,
    agent_available_seconds: 7200,
  };
}

function jobRow(over: Partial<ExportJobRow>): ExportJobRow {
  return {
    id: "job-1",
    bankId: "bank-1",
    requestedBy: "user-1",
    scope: encodeScope("agency", "ag-1"),
    period: "2026-07",
    format: "json",
    status: "PENDING",
    fileUrl: null,
    expiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("REP-003: exportObjectKey — clé déterministe par tenant/job/format", () => {
  it("REP-003: clé = exports/<bank>/<job>.<format>", () => {
    expect(exportObjectKey("bank-1", "job-1", "pdf")).toBe("exports/bank-1/job-1.pdf");
  });
});

describe("REP-003: buildExportModel — dérive de REP-001, réseau anonymisé", () => {
  it("REP-003: agency — agrégat de l'agence + partial calculé", async () => {
    const { query } = makeQuery([statsRow("ag-1")]);
    const model = await buildExportModel(
      { query, storage: new MockObjectStorage({ secret: "s" }), now: () => NOW },
      jobRow({ scope: encodeScope("agency", "ag-1") })
    );
    expect(model.scope).toBe("agency");
    expect(model.aggregate.ticketsIssued).toBe(100);
  });

  it("REP-003: network — agencyCount sans identifiant d'agence exposé", async () => {
    const { query } = makeQuery([statsRow("ag-1"), statsRow("ag-2")]);
    const model = await buildExportModel(
      { query, storage: new MockObjectStorage({ secret: "s" }), now: () => NOW },
      jobRow({ scope: encodeScope("network") })
    );
    expect(model.scope).toBe("network");
    if (model.scope === "network") {
      expect(model.agencyCount).toBe(2);
      expect(model.aggregate.ticketsIssued).toBe(200);
    }
  });
});

describe("REP-003: runExportBuild — PENDING→PROCESSING→READY + URL signée", () => {
  it("REP-003: stocke le fichier, signe l'URL TTL 24 h, passe READY", async () => {
    const { query, updates } = makeQuery([statsRow("ag-1")]);
    const storage = new MockObjectStorage({ secret: "sekret" });
    const putSpy = vi.spyOn(storage, "put");
    const result = await runExportBuild(
      { query, storage, now: () => new Date() },
      jobRow({ format: "json" })
    );
    // 1er UPDATE = PROCESSING, dernier = READY avec file_url + expires_at.
    expect(updates[0]!.sql).toContain("PROCESSING");
    const readyUpdate = updates.find((u) => u.sql.includes("READY"));
    expect(readyUpdate).toBeDefined();
    expect(putSpy).toHaveBeenCalledOnce();
    expect(result.fileUrl).toContain("/download?");
    expect(result.expiresAt.getTime()).toBe(NOW.getTime() + 24 * 60 * 60 * 1000);
    // Le fichier stocké est bien dérivé (JSON non vide).
    const stored = storage.get(exportObjectKey("bank-1", "job-1", "json"));
    expect(stored?.contentType).toBe("application/json");
    expect(JSON.parse(stored!.body.toString("utf-8"))["totalTickets"]).toBe(100);
  });

  it("REP-003: génération échoue (période invalide) → FAILED, jamais READY", async () => {
    const { query, updates } = makeQuery([statsRow("ag-1")]);
    const storage = new MockObjectStorage({ secret: "sekret" });
    await expect(
      runExportBuild(
        { query, storage, now: () => new Date() },
        jobRow({ period: "not-a-period" })
      )
    ).rejects.toThrow();
    expect(updates.some((u) => u.sql.includes("FAILED"))).toBe(true);
    expect(updates.some((u) => u.sql.includes("READY"))).toBe(false);
  });
});
