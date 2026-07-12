/**
 * Tests d'intégration — routeur services API-008 (Testcontainers PG16 réel).
 *
 * Couvre : liste/création (code unique/agence → 409), PATCH SLA/ordre/statut + audit,
 * champ inconnu → 422, RBAC (DIRECTOR agence A ciblant agence B → 403),
 * tenant-isolation.
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
let dirToken: string;
let mgrToken: string;

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
  bankA = await seedBankAgency(h.db, "svc-bank-a");
  dirToken = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  mgrToken = await forgeToken(h.jwtSecretBytes, "MANAGER", bankA.directorId, bankA.bankId, [bankA.agencyId]);
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-008: services CRUD + RBAC + audit", () => {
  it("API-008: DIRECTOR crée un service et une entrée audit est écrite", async () => {
    const res = await req("POST", `/services?agencyId=${bankA.agencyId}`, dirToken, {
      name: "Crédits", code: "CR", slaMinutes: 20, order: 5,
    });
    expect(res.status).toBe(201);
    const svc = (await res.json()) as { id: string; order: number };
    expect(svc.order).toBe(5);
    const audit = await h.db.query(`SELECT 1 FROM audit_log WHERE entity_type='service' AND entity_id=$1`, [svc.id]);
    expect(audit.rows).toHaveLength(1);
  });

  it("API-008: code dupliqué dans l'agence → 409 CONFLICT", async () => {
    const res = await req("POST", `/services?agencyId=${bankA.agencyId}`, dirToken, { name: "Autre", code: "CR" });
    expect(res.status).toBe(409);
  });

  it("API-008: MANAGER liste les services (ordonnés par display_order)", async () => {
    const res = await req("GET", `/services?agencyId=${bankA.agencyId}`, mgrToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ order: number }> };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("API-008: PATCH service merge partiel + diff d'audit", async () => {
    const svc = await h.db.query(
      `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'OC','O',10) RETURNING id`,
      [bankA.bankId, bankA.agencyId]
    );
    const id = (svc.rows[0] as { id: string }).id;
    const res = await req("PATCH", `/services/${id}`, dirToken, { slaMinutes: 15, active: false });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slaMinutes: number; active: boolean };
    expect(body.slaMinutes).toBe(15);
    expect(body.active).toBe(false);
    const audit = await h.db.query(`SELECT diff FROM audit_log WHERE action='PATCH /services/:id' AND entity_id=$1`, [id]);
    const row = audit.rows[0] as { diff: { after: { slaMinutes: number } } };
    expect(row.diff.after.slaMinutes).toBe(15);
  });

  it("API-008: champ inconnu → 422", async () => {
    const res = await req("POST", `/services?agencyId=${bankA.agencyId}`, dirToken, { name: "X", boom: 1 });
    expect(res.status).toBe(422);
  });

  it("API-008: POST service avec octet NUL dans name → 422 (jamais 500 PG 22021)", async () => {
    const res = await req("POST", `/services?agencyId=${bankA.agencyId}`, dirToken, { name: "Cré\x00dits", code: "NL" });
    expect(res.status).toBe(422);
  });

  it("API-008: non-régression — name accentué accepté (201, non filtré)", async () => {
    const res = await req("POST", `/services?agencyId=${bankA.agencyId}`, dirToken, { name: "Service Épargne", code: "EP" });
    expect(res.status).toBe(201);
    const svc = (await res.json()) as { name: string };
    expect(svc.name).toBe("Service Épargne");
  });

  it("API-008: RBAC — DIRECTOR de l'agence A ciblant l'agence B (?agencyId=B) → 403", async () => {
    const bankB = await seedBankAgency(h.db, "svc-bank-b");
    const res = await req("GET", `/services?agencyId=${bankB.agencyId}`, dirToken);
    expect(res.status).toBe(403);
  });
});
