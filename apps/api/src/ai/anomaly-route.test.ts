/**
 * IA-003 — Tests unitaires de la projection/route `GET /ai/anomalies` (CONTRACT-008).
 *
 * Couvre : projection `ai_anomalies` → `Anomaly` (evidence CONTRACT-013), filtre
 * status (défaut open, énum fermée), forme `AnomaliesListResponse` (meta/aiMeta),
 * evidence structurée extraite du payload, aucune fuite de champ hors contrat.
 *
 * Les I/O DB sont GATED (données réelles) ; ces tests valident la logique PURE.
 *
 * Nommage strict : `IA-003: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import {
  ANOMALY_MODEL_VERSION,
  projectAnomalyRow,
  extractEvidence,
  parseStatusFilter,
  buildAnomaliesResponse,
  computeDataWindow,
  loadAnomalies,
  createAnomalyRouter,
  type AnomalyRow,
  type QueryFn,
} from "src/ai/anomaly-route.js";

const AGENCY = "33333333-3333-4333-a333-333333333333";
const SERVICE = "88888888-8888-4888-a888-888888888888";
const AGENT = "55555555-5555-4555-a555-555555555505";

const baseRow: AnomalyRow = {
  id: "anomaly_01",
  type: "AGENT_INACTIVE_PATTERN",
  status: "open",
  agency_id: AGENCY,
  payload: {
    agentId: AGENT,
    description: "Agent inactif : 4 alertes sur 7 jours (seuil : ≥3).",
    alertCount: 4,
    windowDays: 7,
    evidence: [
      { metric: "inactive_alerts", threshold: 3, window: "7d", sample: 4 },
    ],
  },
  detected_at: new Date("2026-07-11T08:00:00Z"),
  acked_by: null,
  acked_at: null,
  resolved_at: null,
};

describe("parseStatusFilter", () => {
  it("IA-003: filtre status défaut = open (CONTRACT-008)", () => {
    expect(parseStatusFilter(undefined)).toBe("open");
  });

  it("IA-003: filtre status accepte open|acked|resolved (énum fermée)", () => {
    expect(parseStatusFilter("acked")).toBe("acked");
    expect(parseStatusFilter("resolved")).toBe("resolved");
  });

  it("IA-003: filtre status hors énum → 400 VALIDATION_ERROR", () => {
    expect(() => parseStatusFilter("bogus")).toThrowError(SigfaError);
  });
});

describe("extractEvidence (CONTRACT-013)", () => {
  it("IA-003: extrait les preuves structurées bien formées du payload", () => {
    const ev = extractEvidence({
      evidence: [{ metric: "sla_rate", threshold: 0.8, window: "5d", sample: 3 }],
    });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toEqual({ metric: "sla_rate", threshold: 0.8, window: "5d", sample: 3 });
  });

  it("IA-003: ignore les preuves malformées (pas de champ inventé)", () => {
    const ev = extractEvidence({
      evidence: [{ metric: "x" }, { threshold: 3 }, "nope", null],
    });
    expect(ev).toHaveLength(0);
  });

  it("IA-003: payload sans evidence → tableau vide", () => {
    expect(extractEvidence({})).toEqual([]);
    expect(extractEvidence(null)).toEqual([]);
  });
});

describe("projectAnomalyRow (evidence CONTRACT-013)", () => {
  it("IA-003: chaque anomalie porte evidence lisible (métrique/seuil/fenêtre/échantillon) (test)", () => {
    const a = projectAnomalyRow(baseRow, "2026-07-04/2026-07-11", "2026-07-11T08:00:00Z");
    expect(a["type"]).toBe("AGENT_INACTIVE_PATTERN");
    expect(a["agentId"]).toBe(AGENT);
    expect(a["alertCount"]).toBe(4);
    const evidence = a["evidence"] as Array<Record<string, unknown>>;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toEqual({ metric: "inactive_alerts", threshold: 3, window: "7d", sample: 4 });
    const meta = a["meta"] as Record<string, unknown>;
    expect(meta["modelVersion"]).toBe(ANOMALY_MODEL_VERSION);
    expect(a["detectedAt"]).toBe("2026-07-11T08:00:00.000Z");
  });

  it("IA-003: projette un QUEUE_STUCK avec serviceId et sans agentId", () => {
    const row: AnomalyRow = {
      ...baseRow,
      id: "anomaly_02",
      type: "QUEUE_STUCK",
      status: "acked",
      payload: {
        serviceId: SERVICE,
        description: "File bloquée 45 min.",
        evidence: [{ metric: "stuck_minutes", threshold: 15, window: "PT15M", sample: 45 }],
      },
      acked_by: "user_manager_01",
      acked_at: new Date("2026-07-10T14:45:00Z"),
    };
    const a = projectAnomalyRow(row, "2026-07-04/2026-07-11", "2026-07-11T08:00:00Z");
    expect(a["serviceId"]).toBe(SERVICE);
    expect(a).not.toHaveProperty("agentId");
    expect(a["status"]).toBe("acked");
    expect(a["ackedBy"]).toBe("user_manager_01");
    expect(a["ackedAt"]).toBe("2026-07-10T14:45:00.000Z");
  });

  it("IA-003: anomalie niveau banque (agency_id null) → champ agencyId omis", () => {
    const row: AnomalyRow = { ...baseRow, agency_id: null };
    const a = projectAnomalyRow(row, "2026-07-04/2026-07-11", "2026-07-11T08:00:00Z");
    expect(a).not.toHaveProperty("agencyId");
  });

  it("IA-003: type hors énum → 500 (défense, jamais projeté au client)", () => {
    const row = { ...baseRow, type: "SOMETHING_ELSE" } as unknown as AnomalyRow;
    expect(() => projectAnomalyRow(row, "w", "t")).toThrowError(SigfaError);
  });
});

describe("buildAnomaliesResponse & computeDataWindow", () => {
  it("IA-003: réponse = AnomaliesListResponse (data + meta pagination + aiMeta)", () => {
    const page = { page: 1, limit: 20, offset: 0 };
    const res = buildAnomaliesResponse([baseRow], 1, page, "2026-07-04/2026-07-11", "2026-07-11T08:00:00Z");
    const data = res["data"] as unknown[];
    expect(data).toHaveLength(1);
    expect(res["meta"]).toEqual({ page: 1, limit: 20, total: 1 });
    const aiMeta = res["aiMeta"] as Record<string, unknown>;
    expect(aiMeta["modelVersion"]).toBe(ANOMALY_MODEL_VERSION);
    expect(aiMeta["dataWindow"]).toBe("2026-07-04/2026-07-11");
  });

  it("IA-003: dataWindow = intervalle ISO 8601 des 7 derniers jours", () => {
    const w = computeDataWindow(new Date("2026-07-11T08:00:00Z"));
    expect(w).toBe("2026-07-04/2026-07-11");
  });
});

describe("loadAnomalies (isolation tenant, filtres, pagination)", () => {
  /** Stub de QueryFn capturant SQL + valeurs, renvoyant des rows scriptées. */
  function makeQuery(
    countTotal: number,
    rows: AnomalyRow[]
  ): { query: QueryFn; calls: Array<{ sql: string; values: unknown[] }> } {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const query: QueryFn = (sql, values = []) => {
      calls.push({ sql, values });
      if (/COUNT/.test(sql)) return Promise.resolve({ rows: [{ total: countTotal }] });
      return Promise.resolve({ rows: rows as unknown as Array<Record<string, unknown>> });
    };
    return { query, calls };
  }

  it("IA-003: loadAnomalies isole par bank_id du tenant (jamais du client)", async () => {
    const { query, calls } = makeQuery(1, [baseRow]);
    const res = await loadAnomalies(query, "bank-A", "open", undefined, { page: 1, limit: 20, offset: 0 });
    expect(res.total).toBe(1);
    expect(res.rows).toHaveLength(1);
    // Le premier paramètre lié est TOUJOURS le bankId ; bank_id = $1 dans le WHERE.
    expect(calls[0]!.sql).toContain("bank_id = $1");
    expect(calls[0]!.values[0]).toBe("bank-A");
  });

  it("IA-003: loadAnomalies ajoute le filtre agency_id quand fourni", async () => {
    const { query, calls } = makeQuery(0, []);
    await loadAnomalies(query, "bank-A", "acked", "agency-X", { page: 2, limit: 10, offset: 10 });
    expect(calls[0]!.sql).toContain("agency_id = $3");
    expect(calls[0]!.values).toEqual(["bank-A", "acked", "agency-X"]);
    // La requête de liste porte LIMIT/OFFSET paginés.
    const listCall = calls[1]!;
    expect(listCall.values.slice(-2)).toEqual([10, 10]);
  });
});

describe("createAnomalyRouter (GET /ai/anomalies)", () => {
  // SEC-002 : la route arme la connexion (`withArmedTenant`) qui exige un bankId
  // UUID canonique (jamais interpolé sinon). Le contexte tenant en porte toujours un.
  const BANK = "11111111-1111-4111-a111-111111111111";
  const tenant: TenantContext = {
    bankId: BANK,
    role: "AGENCY_DIRECTOR",
    agencyIds: [AGENCY],
  } as TenantContext;

  type TestEnv = { Variables: { db: unknown; tenant: TenantContext } };

  /**
   * Monte le routeur avec un contexte db/tenant injecté (fake pg client).
   * `ctxTenant` explicitement `null` = simule une route non authentifiée.
   */
  function mountApp(
    fakeRows: AnomalyRow[],
    total: number,
    ctxTenant: TenantContext | null = tenant
  ): Hono<TestEnv> {
    const app = new Hono<TestEnv>();
    const fakeDb = {
      query: (sql: string) =>
        Promise.resolve({
          rows: /COUNT/.test(sql) ? [{ total }] : fakeRows,
        }),
    };
    app.use("*", async (c, next) => {
      if (ctxTenant) c.set("tenant", ctxTenant);
      c.set("db", fakeDb);
      await next();
    });
    app.route("/api/v1", createAnomalyRouter());
    return app;
  }

  it("IA-003: route GET /ai/anomalies renvoie AnomaliesListResponse (200)", async () => {
    const app = mountApp([baseRow], 1);
    const res = await app.request("/api/v1/ai/anomalies");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body["data"] as unknown[]).length).toBe(1);
    expect((body["aiMeta"] as Record<string, unknown>)["modelVersion"]).toBe(ANOMALY_MODEL_VERSION);
  });

  it("IA-003: route rejette status hors énum (400)", async () => {
    const app = mountApp([], 0);
    const res = await app.request("/api/v1/ai/anomalies?status=bogus");
    expect(res.status).toBe(400);
  });

  it("IA-003: route sans contexte tenant → 401 (garde authentification)", async () => {
    const app = mountApp([], 0, null);
    const res = await app.request("/api/v1/ai/anomalies");
    expect(res.status).toBe(401);
  });

  it("IA-003: route refuse une agence hors scope du JWT (403)", async () => {
    const app = mountApp([], 0);
    const res = await app.request("/api/v1/ai/anomalies?agencyId=99999999-9999-4999-a999-999999999999");
    expect(res.status).toBe(403);
  });
});
