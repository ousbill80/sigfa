/**
 * Tests d'intégration — PATCH /agents/:id profil API-008 (Testcontainers PG16).
 *
 * Couvre : mise à jour langues/services/agences/workSchedule + audit,
 * service inconnu → 422, champ inconnu → 422, RBAC (AGENT → 403 car
 * AGENCY_DIRECTOR requis), tenant-isolation.
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
let agentId: string;
let serviceId: string;
let dirToken: string;
let agentToken: string;

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
  bankA = await seedBankAgency(h.db, "prof-bank-a");
  const svc = await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','O') RETURNING id`,
    [bankA.bankId, bankA.agencyId]
  );
  serviceId = (svc.rows[0] as { id: string }).id;
  const ag = await h.db.query(
    `INSERT INTO users (bank_id, email, role) VALUES ($1,'agent-prof@t.ci','AGENT') RETURNING id`,
    [bankA.bankId]
  );
  agentId = (ag.rows[0] as { id: string }).id;
  await h.db.query(`INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`, [bankA.bankId, bankA.agencyId, agentId]);
  dirToken = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  agentToken = await forgeToken(h.jwtSecretBytes, "AGENT", agentId, bankA.bankId, [bankA.agencyId]);
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-008: PATCH profil agent + audit", () => {
  it("API-008: DIRECTOR met à jour langues/services/horaires + audit", async () => {
    const res = await req("PATCH", `/agents/${agentId}`, dirToken, {
      languages: ["FR", "BAOULE"],
      serviceIds: [serviceId],
      workSchedule: { monday: { start: "09:00", end: "18:00" } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { languages: string[]; serviceIds: string[] };
    expect(body.languages).toEqual(["FR", "BAOULE"]);
    expect(body.serviceIds).toContain(serviceId);
    const audit = await h.db.query(
      `SELECT diff FROM audit_log WHERE action='PATCH /agents/:id' AND entity_id=$1`, [agentId]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
    const row = audit.rows[audit.rows.length - 1] as { diff: { after: { languages: string[] } } };
    expect(row.diff.after.languages).toEqual(["FR", "BAOULE"]);
  });

  it("API-008: service inconnu → 422", async () => {
    const res = await req("PATCH", `/agents/${agentId}`, dirToken, {
      serviceIds: ["99999999-9999-4999-a999-999999999999"],
    });
    expect(res.status).toBe(422);
  });

  it("API-008: champ inconnu → 422", async () => {
    const res = await req("PATCH", `/agents/${agentId}`, dirToken, { boom: true });
    expect(res.status).toBe(422);
  });

  it("API-008: RBAC — un AGENT ne peut pas modifier un profil (403)", async () => {
    const res = await req("PATCH", `/agents/${agentId}`, agentToken, { languages: ["FR"] });
    expect(res.status).toBe(403);
  });

  it("API-008: tenant-isolation — DIRECTOR de A ne modifie pas un agent de B (404)", async () => {
    const bankB = await seedBankAgency(h.db, "prof-bank-b");
    const ag = await h.db.query(`INSERT INTO users (bank_id, email, role) VALUES ($1,'b-agent@t.ci','AGENT') RETURNING id`, [bankB.bankId]);
    const otherAgent = (ag.rows[0] as { id: string }).id;
    const res = await req("PATCH", `/agents/${otherAgent}`, dirToken, { languages: ["FR"] });
    expect(res.status).toBe(404);
  });
});
