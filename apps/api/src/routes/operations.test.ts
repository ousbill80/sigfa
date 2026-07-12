/**
 * Tests d'intégration — routeur operations (MODEL-API-A, Testcontainers PG16 réel).
 *
 * Couvre : liste/création (code unique/service → 409 OPERATION_CODE_DUPLICATE),
 * GET/PATCH/DELETE /operations/{id} (404 OPERATION_NOT_FOUND), audit sur mutation,
 * champ inconnu → 422, RBAC (DIRECTOR agence A → 403 sur service agence B),
 * tenant-isolation (cross-bank → 404 opaque).
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
let serviceA: string;
let dirToken: string;
let mgrToken: string;

async function req(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function seedService(bank: BankFixture, code: string): Promise<string> {
  const res = await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,$3,'Svc',12) RETURNING id`,
    [bank.bankId, bank.agencyId, code]
  );
  return (res.rows[0] as { id: string }).id;
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "ops-bank-a");
  serviceA = await seedService(bankA, "OC");
  dirToken = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  mgrToken = await forgeToken(h.jwtSecretBytes, "MANAGER", bankA.directorId, bankA.bankId, [bankA.agencyId]);
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("MODEL-API-A: CRUD opérations (RBAC + audit + additionalProperties 422 + OPERATION_CODE_DUPLICATE)", () => {
  it("MODEL-API-A: DIRECTOR crée une opération et une entrée audit est écrite", async () => {
    const res = await req("POST", `/services/${serviceA}/operations`, dirToken, {
      code: "DEP", name: "Dépôt espèces", slaMinutes: 8, displayOrder: 1, iconKey: "cash",
    });
    expect(res.status).toBe(201);
    const op = (await res.json()) as { id: string; serviceId: string; slaMinutes: number; displayOrder: number };
    expect(op.serviceId).toBe(serviceA);
    expect(op.slaMinutes).toBe(8);
    expect(op.displayOrder).toBe(1);
    const audit = await h.db.query(`SELECT 1 FROM audit_log WHERE entity_type='operation' AND entity_id=$1`, [op.id]);
    expect(audit.rows).toHaveLength(1);
  });

  it("MODEL-API-A: code dupliqué dans le service → 409 OPERATION_CODE_DUPLICATE", async () => {
    const res = await req("POST", `/services/${serviceA}/operations`, dirToken, {
      code: "DEP", name: "Doublon", displayOrder: 2,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("OPERATION_CODE_DUPLICATE");
  });

  it("MODEL-API-A: slaMinutes null/absent accepté (hérite du service)", async () => {
    const res = await req("POST", `/services/${serviceA}/operations`, dirToken, {
      code: "RET", name: "Retrait", displayOrder: 3,
    });
    expect(res.status).toBe(201);
    const op = (await res.json()) as { slaMinutes: number | null };
    expect(op.slaMinutes).toBeNull();
  });

  it("MODEL-API-A: DIRECTOR liste les opérations d'un service", async () => {
    const res = await req("GET", `/services/${serviceA}/operations`, dirToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ code: string }>; meta: { total: number } };
    expect(body.data.length).toBeGreaterThanOrEqual(2);
  });

  it("MODEL-API-A: MANAGER ne peut PAS lister les opérations (RBAC AGENCY_DIRECTOR) → 403", async () => {
    const res = await req("GET", `/services/${serviceA}/operations`, mgrToken);
    expect(res.status).toBe(403);
  });

  it("MODEL-API-A: GET /operations/{id} retourne l'opération", async () => {
    const created = await req("POST", `/services/${serviceA}/operations`, dirToken, {
      code: "VIR", name: "Virement", displayOrder: 4,
    });
    const { id } = (await created.json()) as { id: string };
    const res = await req("GET", `/operations/${id}`, dirToken);
    expect(res.status).toBe(200);
    const op = (await res.json()) as { code: string };
    expect(op.code).toBe("VIR");
  });

  it("MODEL-API-A: PATCH /operations/{id} merge partiel + diff d'audit", async () => {
    const created = await req("POST", `/services/${serviceA}/operations`, dirToken, {
      code: "CHQ", name: "Chèque", displayOrder: 5,
    });
    const { id } = (await created.json()) as { id: string };
    const res = await req("PATCH", `/operations/${id}`, dirToken, { slaMinutes: 5, isActive: false });
    expect(res.status).toBe(200);
    const op = (await res.json()) as { slaMinutes: number; isActive: boolean };
    expect(op.slaMinutes).toBe(5);
    expect(op.isActive).toBe(false);
    const audit = await h.db.query(`SELECT diff FROM audit_log WHERE action='PATCH /operations/:id' AND entity_id=$1`, [id]);
    expect(audit.rows).toHaveLength(1);
  });

  it("MODEL-API-A: PATCH slaMinutes:null re-hérite du service", async () => {
    const created = await req("POST", `/services/${serviceA}/operations`, dirToken, {
      code: "SLA1", name: "SLA", slaMinutes: 9, displayOrder: 6,
    });
    const { id } = (await created.json()) as { id: string };
    const res = await req("PATCH", `/operations/${id}`, dirToken, { slaMinutes: null });
    expect(res.status).toBe(200);
    const op = (await res.json()) as { slaMinutes: number | null };
    expect(op.slaMinutes).toBeNull();
  });

  it("MODEL-API-A: DELETE /operations/{id} → 204 puis 404 OPERATION_NOT_FOUND", async () => {
    const created = await req("POST", `/services/${serviceA}/operations`, dirToken, {
      code: "DEL", name: "ASupprimer", displayOrder: 7,
    });
    const { id } = (await created.json()) as { id: string };
    const del = await req("DELETE", `/operations/${id}`, dirToken);
    expect(del.status).toBe(204);
    const after = await req("GET", `/operations/${id}`, dirToken);
    expect(after.status).toBe(404);
    const body = (await after.json()) as { error: { code: string } };
    expect(body.error.code).toBe("OPERATION_NOT_FOUND");
  });

  it("MODEL-API-A: GET opération inconnue → 404 OPERATION_NOT_FOUND", async () => {
    const res = await req("GET", `/operations/00000000-0000-4000-a000-000000000000`, dirToken);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("OPERATION_NOT_FOUND");
  });

  it("MODEL-API-A: champ inconnu → 422 (additionalProperties:false)", async () => {
    const res = await req("POST", `/services/${serviceA}/operations`, dirToken, {
      code: "AP", name: "X", displayOrder: 8, boom: 1,
    });
    expect(res.status).toBe(422);
  });

  it("MODEL-API-A: code hors regex → 422", async () => {
    const res = await req("POST", `/services/${serviceA}/operations`, dirToken, {
      code: "toolongcode", name: "X", displayOrder: 9,
    });
    expect(res.status).toBe(422);
  });

  it("MODEL-API-A: service parent inconnu → 404 SERVICE_NOT_FOUND", async () => {
    const res = await req("POST", `/services/00000000-0000-4000-a000-000000000000/operations`, dirToken, {
      code: "SN", name: "X", displayOrder: 10,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SERVICE_NOT_FOUND");
  });
});

describe("MODEL-API-A: tenant-isolation operations (cross-agence/bank → refus)", () => {
  it("MODEL-API-A: DIRECTOR agence A ne peut créer une opération sur un service de la banque B → 404 (opaque)", async () => {
    const bankB = await seedBankAgency(h.db, "ops-bank-b");
    const serviceB = await seedService(bankB, "OC");
    const res = await req("POST", `/services/${serviceB}/operations`, dirToken, {
      code: "XB", name: "Cross", displayOrder: 1,
    });
    // Service hors scope tenant → SERVICE_NOT_FOUND (404), jamais 201/500.
    expect(res.status).toBe(404);
  });

  it("MODEL-API-A: DIRECTOR agence A ne peut PATCH une opération de la banque B → 404", async () => {
    const bankB = await seedBankAgency(h.db, "ops-bank-b2");
    const serviceB = await seedService(bankB, "OC");
    const dirTokenB = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankB.directorId, bankB.bankId, [bankB.agencyId]);
    const created = await req("POST", `/services/${serviceB}/operations`, dirTokenB, {
      code: "PB", name: "B", displayOrder: 1,
    });
    const { id } = (await created.json()) as { id: string };
    const res = await req("PATCH", `/operations/${id}`, dirToken, { name: "Hijack" });
    expect(res.status).toBe(404);
  });
});
