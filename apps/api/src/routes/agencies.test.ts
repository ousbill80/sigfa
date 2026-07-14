/**
 * Tests d'intégration — routeur agences API-008 (Testcontainers PG16 réel).
 *
 * Couvre : liste (filtre soft-delete), création BANK_ADMIN + audit, DIRECTOR
 * crée agence → 403 (RBAC), GET scope agence (DIRECTOR agence B → 403),
 * PATCH merge + audit, DELETE soft (409 tickets ouverts / succès + invisibilité),
 * tenant-isolation cross-bank.
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
let dirToken: string;

async function req(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-forwarded-for": "41.67.128.1",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function seedService(bankId: string, agencyId: string): Promise<{ serviceId: string; queueId: string }> {
  const svc = await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','O') RETURNING id`,
    [bankId, agencyId]
  );
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await h.db.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
    [bankId, agencyId, serviceId]
  );
  return { serviceId, queueId: (q.rows[0] as { id: string }).id };
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "ag-bank-a");
  adminToken = await forgeToken(h.jwtSecretBytes, "BANK_ADMIN", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  dirToken = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-008: agences CRUD + soft-delete + RBAC + audit", () => {
  it("API-008: BANK_ADMIN crée une agence et une entrée audit est écrite", async () => {
    const res = await req("POST", "/agencies", adminToken, { name: "Agence Cocody", phone: "+2250700000001" });
    expect(res.status).toBe(201);
    const ag = (await res.json()) as { id: string; timezone: string };
    expect(ag.timezone).toBe("Africa/Abidjan");
    const audit = await h.db.query(`SELECT action FROM audit_log WHERE entity_id = $1 AND entity_type='agency'`, [ag.id]);
    expect(audit.rows).toHaveLength(1);
  });

  it("API-008: RBAC — AGENCY_DIRECTOR ne peut pas créer d'agence (403)", async () => {
    const res = await req("POST", "/agencies", dirToken, { name: "X" });
    expect(res.status).toBe(403);
  });

  it("API-008: RBAC — DIRECTOR de l'agence A lisant l'agence B → 403", async () => {
    const other = await h.db.query(
      `INSERT INTO agencies (bank_id, name) VALUES ($1,'B') RETURNING id`, [bankA.bankId]
    );
    const otherAgencyId = (other.rows[0] as { id: string }).id;
    const res = await req("GET", `/agencies/${otherAgencyId}`, dirToken);
    expect(res.status).toBe(403);
  });

  it("WEB-002-HDR: RBAC — AGENT lit SA propre agence → 200 (nom d'agence du bandeau session)", async () => {
    // Contrat core 1.1.0 : GET /agencies/{id} passe de AGENCY_DIRECTOR à AGENT
    // pour que toute console connectée résolve le nom de l'agence de
    // rattachement côté serveur (SessionHeader web).
    const agentToken = await forgeToken(
      h.jwtSecretBytes, "AGENT", bankA.directorId, bankA.bankId, [bankA.agencyId]
    );
    const res = await req("GET", `/agencies/${bankA.agencyId}`, agentToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.id).toBe(bankA.agencyId);
    expect(typeof body.name).toBe("string");
    expect(body.name.length).toBeGreaterThan(0);
  });

  it("WEB-002-HDR: RBAC — AGENT lisant une agence HORS de son périmètre agencyIds → 403 (scope agency inchangé)", async () => {
    const other = await h.db.query(
      `INSERT INTO agencies (bank_id, name) VALUES ($1,'HorsPerimetre') RETURNING id`, [bankA.bankId]
    );
    const otherAgencyId = (other.rows[0] as { id: string }).id;
    const agentToken = await forgeToken(
      h.jwtSecretBytes, "AGENT", bankA.directorId, bankA.bankId, [bankA.agencyId]
    );
    const res = await req("GET", `/agencies/${otherAgencyId}`, agentToken);
    expect(res.status).toBe(403);
  });

  it("API-008: PATCH merge partiel + diff d'audit", async () => {
    const res = await req("PATCH", `/agencies/${bankA.agencyId}`, dirToken, { name: "Agence renommée" });
    expect(res.status).toBe(200);
    const audit = await h.db.query(
      `SELECT diff FROM audit_log WHERE action='PATCH /agencies/:id' AND entity_id=$1`, [bankA.agencyId]
    );
    const row = audit.rows[audit.rows.length - 1] as { diff: { after: { name: string } } };
    expect(row.diff.after.name).toBe("Agence renommée");
  });

  it("API-008: DELETE agence avec ticket ouvert → 409 AGENCY_HAS_OPEN_TICKETS", async () => {
    const del = await h.db.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'Del1') RETURNING id`, [bankA.bankId]);
    const agencyId = (del.rows[0] as { id: string }).id;
    const { serviceId, queueId } = await seedService(bankA.bankId, agencyId);
    await h.db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, status) VALUES ($1,$2,$3,$4,1,'WAITING')`,
      [bankA.bankId, agencyId, queueId, serviceId]
    );
    const res = await req("DELETE", `/agencies/${agencyId}`, adminToken);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AGENCY_HAS_OPEN_TICKETS");
  });

  it("API-008: DELETE agence sans ticket ouvert → soft-delete + invisible des listes", async () => {
    const del = await h.db.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'Del2') RETURNING id`, [bankA.bankId]);
    const agencyId = (del.rows[0] as { id: string }).id;
    const res = await req("DELETE", `/agencies/${agencyId}`, adminToken);
    expect(res.status).toBe(200);
    // Invisible en lecture directe
    const get = await req("GET", `/agencies/${agencyId}`, adminToken);
    expect(get.status).toBe(404);
    // Invisible des listes
    const list = await req("GET", "/agencies", adminToken);
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.find((a) => a.id === agencyId)).toBeUndefined();
    // Audit écrit
    const audit = await h.db.query(`SELECT 1 FROM audit_log WHERE action='DELETE /agencies/:id' AND entity_id=$1`, [agencyId]);
    expect(audit.rows).toHaveLength(1);
  });

  it("API-008: tenant-isolation — BANK_ADMIN de A ne supprime pas une agence de B (404)", async () => {
    const bankB = await seedBankAgency(h.db, "ag-bank-b");
    const res = await req("DELETE", `/agencies/${bankB.agencyId}`, adminToken);
    expect(res.status).toBe(404);
  });

  it("API-008: champ inconnu sur PATCH agence → 422", async () => {
    const res = await req("PATCH", `/agencies/${bankA.agencyId}`, dirToken, { nope: 1 });
    expect(res.status).toBe(422);
  });

  it("API-008: POST agence avec octet NUL dans name → 422 (jamais 500 PG 22021)", async () => {
    const res = await req("POST", "/agencies", adminToken, { name: "Agence\x00Cocody" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNPROCESSABLE_ENTITY");
  });

  it("API-008: POST agence avec octet NUL dans address → 422 (pas 500)", async () => {
    const res = await req("POST", "/agencies", adminToken, {
      name: "Agence Plateau",
      address: "Rue\x00des Banques",
    });
    expect(res.status).toBe(422);
  });

  it("API-008: non-régression — name accentué (FR) accepté (201, non filtré)", async () => {
    const res = await req("POST", "/agencies", adminToken, {
      name: "Agence Générale Abidjan",
      address: "Boulevard de la Paix, Cocody",
    });
    expect(res.status).toBe(201);
    const ag = (await res.json()) as { name: string };
    expect(ag.name).toBe("Agence Générale Abidjan");
  });
});
