/**
 * Tests d'intégration — routeur seuils de banque API-008 (Testcontainers PG16).
 *
 * Couvre : GET/PATCH bornés, merge partiel n'écrase pas les horaires,
 * hors bornes → 422, audit, RBAC (AUDITOR → 403), tenant-isolation.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "src/app.js";
import {
  startAdminHarness,
  stopAdminHarness,
  forgeToken,
  seedBankAgency,
  type AdminHarness,
  type BankFixture,
} from "src/routes/admin-test-harness.js";

let h: AdminHarness;
let app: ReturnType<typeof createApp>;
let bankA: BankFixture;
let adminToken: string;
let auditorToken: string;

async function req(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "thr-bank-a");
  adminToken = await forgeToken(h.jwtSecretBytes, "BANK_ADMIN", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  auditorToken = await forgeToken(h.jwtSecretBytes, "AUDITOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-008: seuils de banque + audit", () => {
  it("API-008: GET thresholds retourne les valeurs par défaut", async () => {
    const res = await req("GET", `/banks/${bankA.bankId}/thresholds`, adminToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queueCriticalThreshold: number };
    expect(body.queueCriticalThreshold).toBe(50);
  });

  it("API-008: PATCH thresholds merge partiel + audit, n'écrase pas les horaires", async () => {
    await h.db.query(
      `UPDATE agencies SET weekly_schedule=$2::jsonb WHERE bank_id=$1`,
      [bankA.bankId, JSON.stringify({ monday: { open: "08:00", close: "17:00", closed: false } })]
    );
    const res = await req("PATCH", `/banks/${bankA.bankId}/thresholds`, adminToken, {
      queueCriticalThreshold: 100, noShowTimeoutMinutes: 5,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queueCriticalThreshold: number; agentInactivityMinutes: number; noShowTimeoutMinutes: number };
    expect(body.queueCriticalThreshold).toBe(100);
    expect(body.agentInactivityMinutes).toBe(15); // préservé (non fourni)
    expect(body.noShowTimeoutMinutes).toBe(5);
    // Horaires intacts
    const ag = await h.db.query(`SELECT weekly_schedule FROM agencies WHERE bank_id=$1 LIMIT 1`, [bankA.bankId]);
    expect((ag.rows[0] as { weekly_schedule: { monday: { open: string } } }).weekly_schedule.monday.open).toBe("08:00");
    const audit = await h.db.query(
      `SELECT 1 FROM audit_log WHERE action='PATCH /banks/:id/thresholds' AND entity_id=$1`, [bankA.bankId]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("API-008: valeur hors bornes → 422 (queueCriticalThreshold > 500)", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/thresholds`, adminToken, { queueCriticalThreshold: 999 });
    expect(res.status).toBe(422);
  });

  it("API-008: RBAC — AUDITOR ne peut pas modifier les seuils (403)", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/thresholds`, auditorToken, { queueCriticalThreshold: 60 });
    expect(res.status).toBe(403);
  });

  it("API-008: tenant-isolation — BANK_ADMIN de A ne lit pas les seuils de B (403)", async () => {
    const bankB = await seedBankAgency(h.db, "thr-bank-b");
    const res = await req("GET", `/banks/${bankB.bankId}/thresholds`, adminToken);
    expect(res.status).toBe(403);
  });
});
