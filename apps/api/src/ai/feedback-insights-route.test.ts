/**
 * IA-004 — Tests du routeur GET /ai/feedback-insights (RBAC-scope, validation,
 * projection). Le middleware global (auth/RBAC/tenant) est simulé par un contexte
 * injecté ; on teste ici la logique de résolution de scope et la projection.
 *
 * Nommage strict : `IA-004: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Client } from "pg";
import type { TenantContext } from "src/middleware/tenant.js";
import { createFeedbackInsightsRouter } from "src/ai/feedback-insights-route.js";
import { MIN_SAMPLE_SIZE } from "src/ai/quality-scoring.js";

/** Env Hono minimal du harnais de test (db + tenant injectés). */
interface TestEnv {
  Variables: {
    db: Client;
    tenant: TenantContext;
  };
}

const BANK_A = "11111111-1111-4111-8111-111111111111";
const AGENCY_A = "aaaaaaaa-1111-4111-8111-111111111111";
const AGENCY_OTHER = "bbbbbbbb-2222-4222-8222-222222222222";

/** Fabrique un faux Client pg qui renvoie des lignes fixes et capture les requêtes. */
function fakeDb(rows: Array<Record<string, unknown>>): {
  db: Client;
  queries: Array<{ sql: string; params: unknown[] }>;
} {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: (params ?? []) as unknown[] });
      return Promise.resolve({ rows });
    },
  } as unknown as Client;
  return { db, queries };
}

/** Monte le routeur avec un contexte tenant injecté (middleware simulé). */
function appWith(
  tenant: TenantContext,
  rows: Array<Record<string, unknown>>
): { app: Hono<TestEnv>; queries: Array<{ sql: string; params: unknown[] }> } {
  const { db, queries } = fakeDb(rows);
  const app = new Hono<TestEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("tenant", tenant);
    await next();
  });
  app.route("/api/v1", createFeedbackInsightsRouter());
  return { app, queries };
}

const DIRECTOR: TenantContext = {
  requestId: "req-1",
  userId: "user-director",
  bankId: BANK_A,
  role: "AGENCY_DIRECTOR",
  agencyIds: [AGENCY_A],
};

const BANK_ADMIN: TenantContext = {
  requestId: "req-2",
  userId: "user-admin",
  bankId: BANK_A,
  role: "BANK_ADMIN",
  agencyIds: [],
};

function rows(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    feedback_score: i % 2 === 0 ? 5 : 2,
    feedback_comment: i % 2 === 0 ? "service rapide et propre" : "attente longue et lente",
  }));
}

describe("feedback-insights-route", () => {
  it("IA-004: 200 — insights d'agence pour un AGENCY_DIRECTOR", async () => {
    const { app } = appWith(DIRECTOR, rows(MIN_SAMPLE_SIZE));
    const res = await app.request("/api/v1/ai/feedback-insights?period=2026-07");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["scope"]).toBe("agency");
    expect(body["agencyId"]).toBe(AGENCY_A);
    expect(body["feedbackCount"]).toBe(MIN_SAMPLE_SIZE);
    expect(body["insufficientSample"]).toBe(false);
  });

  it("IA-004: 400 — période manquante/invalide", async () => {
    const { app } = appWith(DIRECTOR, []);
    const res = await app.request("/api/v1/ai/feedback-insights");
    expect(res.status).toBe(400);
    const res2 = await app.request("/api/v1/ai/feedback-insights?period=not-a-date");
    expect(res2.status).toBe(400);
  });

  it("IA-004: 403 — agence hors périmètre du JWT", async () => {
    const { app } = appWith(DIRECTOR, []);
    const res = await app.request(
      `/api/v1/ai/feedback-insights?period=2026-07&agencyId=${AGENCY_OTHER}`
    );
    expect(res.status).toBe(403);
  });

  it("IA-004: scope=bank — vue réseau pour BANK_ADMIN (bank_id seul)", async () => {
    const { app, queries } = appWith(BANK_ADMIN, rows(MIN_SAMPLE_SIZE));
    const res = await app.request(
      "/api/v1/ai/feedback-insights?period=2026-07&scope=bank"
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["scope"]).toBe("bank");
    // La requête n'a filtré que sur bank_id (aucun agency_id positionnel $4).
    expect(queries[0]!.params[0]).toBe(BANK_A);
    expect(queries[0]!.params).toHaveLength(3);
  });

  it("IA-004: 400 — scope agence, aucune agence unique liée au JWT, sans agencyId", async () => {
    const multi: TenantContext = {
      requestId: "req-4",
      userId: "user-multi",
      bankId: BANK_A,
      role: "AGENCY_DIRECTOR",
      agencyIds: [AGENCY_A, AGENCY_OTHER],
    };
    const { app } = appWith(multi, []);
    const res = await app.request("/api/v1/ai/feedback-insights?period=2026-07");
    expect(res.status).toBe(400);
  });

  it("IA-004: 403 — contexte sans bankId (requireBankId)", async () => {
    const noBank: TenantContext = {
      requestId: "req-3",
      userId: "user-super",
      bankId: null,
      role: "SUPER_ADMIN",
      agencyIds: [],
    };
    const { app } = appWith(noBank, []);
    const res = await app.request("/api/v1/ai/feedback-insights?period=2026-07");
    expect(res.status).toBe(403);
  });

  it("IA-004: lecture seule — aucune requête de mutation (SELECT uniquement)", async () => {
    const { app, queries } = appWith(DIRECTOR, rows(MIN_SAMPLE_SIZE));
    await app.request("/api/v1/ai/feedback-insights?period=2026-07");
    for (const q of queries) {
      expect(q.sql.trim().toUpperCase()).toContain("SELECT");
      expect(q.sql.toUpperCase()).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    }
  });
});
