/**
 * IA-001 — Tests unitaires de l'orchestrateur (garde tenant paramétrée, chargement
 * fériés, agrégation) sans conteneur : la `ReportQueryFn` est un faux déterministe.
 *
 * Nommage strict : `IA-001: <description>`.
 *
 * @module
 */

import { describe, it, expect, vi } from "vitest";
import type { QueryFn as ReportQueryFn } from "src/reporting/aggregate-service.js";
import { withTenantParam, runFeaturePipeline } from "src/ai/feature-pipeline.js";
import { InMemoryFeatureStore } from "src/ai/feature-store.js";

const BANK = "11111111-1111-4111-8111-111111111111";

describe("feature-pipeline (unit)", () => {
  it("IA-001: withTenantParam ouvre BEGIN + SET LOCAL + COMMIT dans l'ordre", async () => {
    const calls: string[] = [];
    const q: ReportQueryFn = async (sql) => {
      calls.push(sql.trim().split("\n")[0]!.trim());
      return { rows: [] };
    };
    const out = await withTenantParam(q, BANK, async () => "ok");
    expect(out).toBe("ok");
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toContain("SET LOCAL app.current_bank_id");
    expect(calls[1]).toContain(BANK);
    expect(calls.at(-1)).toBe("COMMIT");
  });

  it("IA-001: withTenantParam refuse un bankId non-UUID (anti-injection)", async () => {
    const q: ReportQueryFn = async () => ({ rows: [] });
    await expect(
      withTenantParam(q, "'; DROP TABLE tickets; --", async () => "x")
    ).rejects.toThrow(/UUID/);
  });

  it("IA-001: withTenantParam ROLLBACK si le callback échoue", async () => {
    const calls: string[] = [];
    const q: ReportQueryFn = async (sql) => {
      calls.push(sql.trim().split("\n")[0]!.trim());
      return { rows: [] };
    };
    await expect(
      withTenantParam(q, BANK, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
  });

  it("IA-001: ROLLBACK défaillant est avalé (connexion fermée) et l'erreur d'origine remonte", async () => {
    const q: ReportQueryFn = async (sql) => {
      if (sql.trim() === "ROLLBACK") throw new Error("Connection is closed");
      return { rows: [] };
    };
    await expect(
      withTenantParam(q, BANK, async () => {
        throw new Error("original");
      })
    ).rejects.toThrow("original");
  });

  it("IA-001: run charge les fériés, extrait sous tenant et matérialise", async () => {
    const holidaysQuery = vi.fn<ReportQueryFn>(async () => ({
      rows: [{ d: "2026-08-07" }],
    }));
    // appQuery : BEGIN/SET/COMMIT renvoient vide ; le SELECT tickets renvoie 1 bucket ;
    // le SELECT agent_status_history renvoie vide.
    const appQuery: ReportQueryFn = async (sql) => {
      if (sql.includes("FROM bucketed")) {
        return {
          rows: [
            {
              agency_id: "aaaaaaaa-1111-4111-8111-111111111111",
              service_id: null,
              day: "2026-06-10",
              hour_bucket: 9,
              arrivals: 4,
              served: 3,
              no_show: 0,
              abandoned: 1,
              total_wait_seconds: 300,
              total_service_seconds: 600,
              counters_open: 1,
              p90_wait_seconds: 150,
            },
          ],
        };
      }
      return { rows: [] };
    };
    const store = new InMemoryFeatureStore();
    const res = await runFeaturePipeline(
      { appQuery, holidaysQuery, store, now: new Date("2027-01-01T00:00:00Z") },
      { bankId: BANK, dayStart: "2026-06-10", dayEnd: "2026-06-10" }
    );
    expect(holidaysQuery).toHaveBeenCalledOnce();
    expect(res.produced).toBe(1);
    expect(res.features[0]?.arrivals).toBe(4);
    expect(res.features[0]?.abandoned).toBe(1);
    expect(store.count(BANK)).toBe(1);
  });
});
