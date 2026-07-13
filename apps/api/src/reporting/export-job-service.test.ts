/**
 * REP-003 — Tests unitaires du service `export_jobs` (encode/decode de portée,
 * ownership opaque, transitions) + projection du polling (EXPIRED/FAILED).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  encodeScope,
  decodeScope,
  createExportJob,
  loadOwnedJob,
  markProcessing,
  markReady,
  markFailed,
  type ExportJobRow,
} from "src/reporting/export-job-service.js";
import { buildExportStatusResponse } from "src/routes/reports.js";
import type { QueryFn } from "src/reporting/aggregate-service.js";

const NOW = new Date("2026-07-13T09:00:00Z");

describe("REP-003: encode/decode de portée d'export", () => {
  it("REP-003: agency:<uuid> ↔ { scope:agency, agencyId }", () => {
    expect(encodeScope("agency", "ag-1")).toBe("agency:ag-1");
    expect(decodeScope("agency:ag-1")).toEqual({ scope: "agency", agencyId: "ag-1" });
  });
  it("REP-003: network (agencyId ignoré) ↔ { scope:network, agencyId:null }", () => {
    expect(encodeScope("network")).toBe("network");
    expect(encodeScope("agency", null)).toBe("network");
    expect(decodeScope("network")).toEqual({ scope: "network", agencyId: null });
  });
});

/** Ligne SQL brute d'un job (colonnes snake_case). */
function rawJob(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "job-1",
    bank_id: "bank-1",
    requested_by: "user-1",
    scope: "agency:ag-1",
    period: "2026-07",
    format: "json",
    status: "PENDING",
    file_url: null,
    expires_at: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...over,
  };
}

describe("REP-003: createExportJob — insère PENDING et renvoie la ligne", () => {
  it("REP-003: INSERT paramétré + mapping camelCase", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const query: QueryFn = (sql, values) => {
      calls.push({ sql, values: (values ?? []) as unknown[] });
      return Promise.resolve({ rows: [rawJob()] });
    };
    const job = await createExportJob(query, {
      bankId: "bank-1",
      requestedBy: "user-1",
      scope: "agency",
      agencyId: "ag-1",
      periodKey: "2026-07",
      format: "json",
    });
    expect(calls[0]!.sql).toContain("INSERT INTO export_jobs");
    expect(calls[0]!.values).toEqual(["bank-1", "user-1", "agency:ag-1", "2026-07", "json"]);
    expect(job.status).toBe("PENDING");
    expect(job.bankId).toBe("bank-1");
  });
});

describe("REP-003: loadOwnedJob — ownership OPAQUE (404 côté route)", () => {
  it("REP-003: job absent → null", async () => {
    const query: QueryFn = () => Promise.resolve({ rows: [] });
    expect(await loadOwnedJob(query, "x", "bank-1", "user-1", "AGENCY_DIRECTOR")).toBeNull();
  });
  it("REP-003: job d'un AUTRE demandeur (même tenant), non-AUDITOR → null", async () => {
    const query: QueryFn = () => Promise.resolve({ rows: [rawJob({ requested_by: "other" })] });
    expect(await loadOwnedJob(query, "job-1", "bank-1", "user-1", "AGENCY_DIRECTOR")).toBeNull();
  });
  it("REP-003: le demandeur voit son propre job", async () => {
    const query: QueryFn = () => Promise.resolve({ rows: [rawJob({ requested_by: "user-1" })] });
    const job = await loadOwnedJob(query, "job-1", "bank-1", "user-1", "AGENCY_DIRECTOR");
    expect(job?.id).toBe("job-1");
  });
  it("REP-003: AUDITOR voit tout job de SON tenant", async () => {
    const query: QueryFn = () => Promise.resolve({ rows: [rawJob({ requested_by: "someone" })] });
    const job = await loadOwnedJob(query, "job-1", "bank-1", "auditor", "AUDITOR");
    expect(job?.id).toBe("job-1");
  });
});

describe("REP-003: transitions — UPDATE paramétrés garde tenant", () => {
  it("REP-003: markProcessing / markReady / markFailed filtrent bank_id", async () => {
    const calls: string[] = [];
    const query: QueryFn = (sql) => {
      calls.push(sql);
      return Promise.resolve({ rows: [] });
    };
    await markProcessing(query, "job-1", "bank-1", NOW);
    await markReady(query, "job-1", "bank-1", "https://u/download?x", new Date(NOW.getTime() + 1000), NOW);
    await markFailed(query, "job-1", "bank-1", NOW);
    expect(calls[0]).toContain("PROCESSING");
    expect(calls[1]).toContain("READY");
    expect(calls[2]).toContain("FAILED");
    expect(calls.every((s) => s.includes("bank_id = $2"))).toBe(true);
  });
});

describe("REP-003: buildExportStatusResponse — READY/EXPIRED/FAILED", () => {
  function job(over: Partial<ExportJobRow>): ExportJobRow {
    return {
      id: "job-1",
      bankId: "bank-1",
      requestedBy: "user-1",
      scope: "agency:ag-1",
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

  it("REP-003: READY non expiré → downloadUrl + expiresAt", () => {
    const exp = new Date(NOW.getTime() + 60_000);
    const res = buildExportStatusResponse(
      job({ status: "READY", fileUrl: "https://u/download?x", expiresAt: exp }),
      NOW
    );
    expect(res["status"]).toBe("READY");
    expect(res["downloadUrl"]).toBe("https://u/download?x");
    expect(res["error"]).toBeUndefined();
  });

  it("REP-003: READY expiré → downloadUrl null + erreur EXPIRED (aucune URL servie)", () => {
    const exp = new Date(NOW.getTime() - 1);
    const res = buildExportStatusResponse(
      job({ status: "READY", fileUrl: "https://u/download?x", expiresAt: exp }),
      NOW
    );
    expect(res["downloadUrl"]).toBeNull();
    expect((res["error"] as { code: string }).code).toBe("EXPORT_URL_EXPIRED");
  });

  it("REP-003: FAILED → erreur EXPORT_GENERATION_FAILED", () => {
    const res = buildExportStatusResponse(job({ status: "FAILED" }), NOW);
    expect((res["error"] as { code: string }).code).toBe("EXPORT_GENERATION_FAILED");
  });

  it("REP-003: PENDING → statut brut sans URL ni erreur", () => {
    const res = buildExportStatusResponse(job({ status: "PENDING" }), NOW);
    expect(res["status"]).toBe("PENDING");
    expect(res["downloadUrl"]).toBeUndefined();
    expect(res["error"]).toBeUndefined();
  });
});
