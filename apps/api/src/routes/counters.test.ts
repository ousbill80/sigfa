/**
 * Tests d'intégration — routeur guichets API-008 (Testcontainers PG16 réel).
 *
 * Couvre : création + counter_services, liste, PATCH statut/agent + audit,
 * service inconnu → 422, tenant-isolation, champ inconnu → 422.
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
let serviceId: string;
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
  bankA = await seedBankAgency(h.db, "ctr-bank-a");
  const svc = await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','O') RETURNING id`,
    [bankA.bankId, bankA.agencyId]
  );
  serviceId = (svc.rows[0] as { id: string }).id;
  dirToken = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  mgrToken = await forgeToken(h.jwtSecretBytes, "MANAGER", bankA.directorId, bankA.bankId, [bankA.agencyId]);
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-008: guichets CRUD + counter_services + audit", () => {
  it("API-008: DIRECTOR crée un guichet avec services couverts + audit", async () => {
    const res = await req("POST", `/counters?agencyId=${bankA.agencyId}`, dirToken, {
      label: "Guichet 1", serviceIds: [serviceId],
    });
    expect(res.status).toBe(201);
    const ctr = (await res.json()) as { id: string; status: string };
    expect(ctr.status).toBe("OPEN");
    const links = await h.db.query(`SELECT 1 FROM counter_services WHERE counter_id=$1`, [ctr.id]);
    expect(links.rows).toHaveLength(1);
    const audit = await h.db.query(`SELECT 1 FROM audit_log WHERE entity_type='counter' AND entity_id=$1`, [ctr.id]);
    expect(audit.rows).toHaveLength(1);
  });

  it("API-008: création avec service inconnu → 422", async () => {
    const res = await req("POST", `/counters?agencyId=${bankA.agencyId}`, dirToken, {
      label: "G2", serviceIds: ["99999999-9999-4999-a999-999999999999"],
    });
    expect(res.status).toBe(422);
  });

  it("API-008: MANAGER liste les guichets", async () => {
    const res = await req("GET", `/counters?agencyId=${bankA.agencyId}`, mgrToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("API-008: PATCH guichet statut/agent + diff d'audit", async () => {
    const ctr = await h.db.query(
      `INSERT INTO counters (bank_id, agency_id, number, label, status) VALUES ($1,$2,50,'GP','OPEN') RETURNING id`,
      [bankA.bankId, bankA.agencyId]
    );
    const id = (ctr.rows[0] as { id: string }).id;
    const res = await req("PATCH", `/counters/${id}`, mgrToken, { status: "PAUSED", agentId: bankA.directorId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; agentId: string };
    expect(body.status).toBe("PAUSED");
    const audit = await h.db.query(`SELECT diff FROM audit_log WHERE action='PATCH /counters/:id' AND entity_id=$1`, [id]);
    const row = audit.rows[0] as { diff: { after: { status: string } } };
    expect(row.diff.after.status).toBe("PAUSED");
  });

  it("API-008: champ inconnu sur PATCH guichet → 422", async () => {
    const ctr = await h.db.query(
      `INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,51,'GX') RETURNING id`,
      [bankA.bankId, bankA.agencyId]
    );
    const id = (ctr.rows[0] as { id: string }).id;
    const res = await req("PATCH", `/counters/${id}`, mgrToken, { nope: true });
    expect(res.status).toBe(422);
  });

  it("API-008: tenant-isolation — MANAGER de A ne PATCH pas un guichet de B (404)", async () => {
    const bankB = await seedBankAgency(h.db, "ctr-bank-b");
    const ctr = await h.db.query(
      `INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,1,'GB') RETURNING id`,
      [bankB.bankId, bankB.agencyId]
    );
    const id = (ctr.rows[0] as { id: string }).id;
    const res = await req("PATCH", `/counters/${id}`, mgrToken, { status: "CLOSED" });
    expect(res.status).toBe(404);
  });
});
