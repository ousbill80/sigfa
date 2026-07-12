/**
 * Tests d'intégration — MODEL-API-B : conseiller (liste publique + marquage +
 * ticket ciblant un conseiller). PG 16 + Redis 7 réels (Testcontainers).
 *
 * Nommage strict : `MODEL-API-B: <description>`.
 *
 * Couvre :
 * - Liste publique NOMINATIVE `GET /public/agencies/{id}/relationship-managers`
 *   → `{ id, displayName, photoUrl? }` UNIQUEMENT, ZÉRO PII, conseillers actifs seuls.
 * - Marquage `PATCH /agents/{id}` (RBAC AGENCY_DIRECTOR) + audit.
 * - Ticket `POST /tickets` / `POST /public/tickets` avec `targetManagerId` →
 *   `target_manager_id` posé ; inconnu/non-conseiller/hors agence → 404
 *   `RELATIONSHIP_MANAGER_NOT_FOUND`.
 * - tenant-isolation : conseiller/ticket cross-agence → refus.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createApp } from "src/app.js";
import {
  applyAdminSchemaForTest,
  ADMIN_JWT_SECRET,
} from "src/routes/model-api-b.harness.js";

process.env["PHONE_ENCRYPTION_KEY"] =
  process.env["PHONE_ENCRYPTION_KEY"] ??
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  process.env["PHONE_HASH_KEY"] ??
  "2222222222222222222222222222222222222222222222222222222222222222";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let app: ReturnType<typeof createApp>;
const jwtSecretBytes = new TextEncoder().encode(ADMIN_JWT_SECRET);

interface Fixtures {
  bankId: string;
  agencyId: string;
  serviceId: string;
  directorId: string;
  managerId: string;
  managerBId: string; // conseiller d'une AUTRE agence (isolation)
  agentPlainId: string; // agent NON conseiller
  otherAgencyId: string;
}
let ids: Fixtures;

async function seed(): Promise<Fixtures> {
  const bank = await db.query(`INSERT INTO banks (name, slug) VALUES ('B','b-mab') RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await db.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A1') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const otherAgency = await db.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A2') RETURNING id`, [bankId]);
  const otherAgencyId = (otherAgency.rows[0] as { id: string }).id;

  const svc = await db.query(
    `INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','Ouverture') RETURNING id`,
    [bankId, agencyId]
  );
  const serviceId = (svc.rows[0] as { id: string }).id;
  await db.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3)`, [bankId, agencyId, serviceId]);

  const dir = await db.query(
    `INSERT INTO users (bank_id, email, role) VALUES ($1,'dir-mab@t.ci','AGENCY_DIRECTOR') RETURNING id`,
    [bankId]
  );
  const directorId = (dir.rows[0] as { id: string }).id;
  await db.query(`INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`, [bankId, agencyId, directorId]);

  // Conseiller actif de l'agence (avec display_name + photo).
  const mgr = await db.query(
    `INSERT INTO users (bank_id, email, role, is_relationship_manager, display_name, photo_url, phone_encrypted)
     VALUES ($1,'mgr-mab@t.ci','AGENT',true,'Kofi A.','https://cdn.sigfa.ci/rm/kofi.jpg','SECRET_PHONE') RETURNING id`,
    [bankId]
  );
  const managerId = (mgr.rows[0] as { id: string }).id;
  await db.query(`INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`, [bankId, agencyId, managerId]);

  // Conseiller d'une AUTRE agence (piège d'isolation).
  const mgrB = await db.query(
    `INSERT INTO users (bank_id, email, role, is_relationship_manager, display_name)
     VALUES ($1,'mgrb-mab@t.ci','AGENT',true,'Awa D.') RETURNING id`,
    [bankId]
  );
  const managerBId = (mgrB.rows[0] as { id: string }).id;
  await db.query(`INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`, [bankId, otherAgencyId, managerBId]);

  // Agent NON conseiller de l'agence (ne doit PAS apparaître).
  const plain = await db.query(
    `INSERT INTO users (bank_id, email, role, is_relationship_manager) VALUES ($1,'plain-mab@t.ci','AGENT',false) RETURNING id`,
    [bankId]
  );
  const agentPlainId = (plain.rows[0] as { id: string }).id;
  await db.query(`INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`, [bankId, agencyId, agentPlainId]);

  // Conseiller inactif (deleted) de l'agence (ne doit PAS apparaître).
  const inactive = await db.query(
    `INSERT INTO users (bank_id, email, role, is_relationship_manager, display_name, is_active, deleted_at)
     VALUES ($1,'gone-mab@t.ci','AGENT',true,'Ancien C.',false,NOW()) RETURNING id`,
    [bankId]
  );
  await db.query(`INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`, [bankId, agencyId, (inactive.rows[0] as { id: string }).id]);

  return { bankId, agencyId, serviceId, directorId, managerId, managerBId, agentPlainId, otherAgencyId };
}

async function token(role: string, sub: string, agencyIds: string[]): Promise<string> {
  return new SignJWT({ role, bankId: ids.bankId, agencyIds })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(jwtSecretBytes);
}

async function req(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string; idem?: string } = {}
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.idem) headers["X-Idempotency-Key"] = opts.idem;
  const res = await app.fetch(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    })
  );
  return { status: res.status, data: await res.json() };
}

beforeAll(async () => {
  pgContainer = await new GenericContainer("postgres:16")
    .withEnvironment({ POSTGRES_USER: "sigfa", POSTGRES_PASSWORD: "sigfa_test", POSTGRES_DB: "sigfa_test" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  redisContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  db = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test`,
  });
  await db.connect();
  redis = new Redis(`redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`);
  await applyAdminSchemaForTest(db);
  app = createApp({ db, redis, jwtSecret: jwtSecretBytes });
  ids = await seed();
}, 180_000);

afterAll(async () => {
  await redis.quit();
  await db.end();
  await pgContainer.stop();
  await redisContainer.stop();
}, 30_000);

beforeEach(async () => {
  await redis.flushall();
  await db.query(`DELETE FROM tickets`);
  await db.query(`DELETE FROM audit_log`);
});

describe("MODEL-API-B: liste publique nominative des conseillers (D5)", () => {
  it("MODEL-API-B: GET .../relationship-managers → {id,displayName,photoUrl?} zéro PII, conseillers actifs de l'agence uniquement", async () => {
    const r = await req("GET", `/public/agencies/${ids.agencyId}/relationship-managers`);
    expect(r.status).toBe(200);
    const data = (r.data as { data: Array<Record<string, unknown>> }).data;
    // Un seul conseiller actif avec display_name dans l'agence.
    expect(data).toHaveLength(1);
    const rm = data[0]!;
    // ZÉRO PII : liste blanche stricte.
    expect(Object.keys(rm).sort()).toEqual(["displayName", "id", "photoUrl"]);
    expect(rm["id"]).toBe(ids.managerId);
    expect(rm["displayName"]).toBe("Kofi A.");
    // Jamais de PII sérialisée.
    const raw = JSON.stringify(r.data);
    expect(raw).not.toContain("SECRET_PHONE");
    expect(raw).not.toContain("mgr-mab@t.ci");
    expect(raw).not.toContain("phone");
    expect(raw).not.toContain("email");
    expect(raw).not.toContain("role");
    expect(raw).not.toContain("AGENT");
  });

  it("MODEL-API-B: conseiller d'une autre agence exclu (tenant/agency-isolation)", async () => {
    const r = await req("GET", `/public/agencies/${ids.otherAgencyId}/relationship-managers`);
    expect(r.status).toBe(200);
    const data = (r.data as { data: Array<Record<string, unknown>> }).data;
    expect(data).toHaveLength(1);
    expect(data[0]!["id"]).toBe(ids.managerBId);
    // Le conseiller de l'agence A1 n'apparaît pas dans A2.
    expect(data.map((x) => x["id"])).not.toContain(ids.managerId);
  });

  it("MODEL-API-B: agencyId malformé → 400", async () => {
    const r = await req("GET", `/public/agencies/not-a-uuid/relationship-managers`);
    expect(r.status).toBe(400);
  });
});

describe("MODEL-API-B: marquage conseiller PATCH /agents/{id} (RBAC + audit)", () => {
  it("MODEL-API-B: AGENCY_DIRECTOR marque un agent conseiller → profil + audit", async () => {
    const dirTok = await token("AGENCY_DIRECTOR", ids.directorId, [ids.agencyId]);
    const r = await req("PATCH", `/agents/${ids.agentPlainId}`, {
      body: { isRelationshipManager: true, displayName: "Yao B.", photoUrl: "https://cdn.sigfa.ci/rm/yao.jpg" },
      token: dirTok,
    });
    expect(r.status).toBe(200);
    const body = r.data as Record<string, unknown>;
    expect(body["isRelationshipManager"]).toBe(true);
    expect(body["displayName"]).toBe("Yao B.");
    expect(body["photoUrl"]).toBe("https://cdn.sigfa.ci/rm/yao.jpg");
    // Audit branché.
    const audit = await db.query(`SELECT action, entity_id FROM audit_log WHERE action = 'PATCH /agents/:id'`);
    expect(audit.rows.length).toBeGreaterThan(0);
    // Le nouvel agent apparaît maintenant dans la liste publique.
    const list = await req("GET", `/public/agencies/${ids.agencyId}/relationship-managers`);
    const data = (list.data as { data: Array<Record<string, unknown>> }).data;
    expect(data.map((x) => x["id"])).toContain(ids.agentPlainId);
    // Remise en état pour les autres tests.
    await db.query(`UPDATE users SET is_relationship_manager=false, display_name=NULL, photo_url=NULL WHERE id=$1`, [ids.agentPlainId]);
  });

  it("MODEL-API-B: AGENT (non directeur) → 403 sur PATCH /agents/{id}", async () => {
    const agentTok = await token("AGENT", ids.managerId, [ids.agencyId]);
    const r = await req("PATCH", `/agents/${ids.agentPlainId}`, {
      body: { isRelationshipManager: true, displayName: "Hack" },
      token: agentTok,
    });
    expect(r.status).toBe(403);
  });
});

describe("MODEL-API-B: ticket ciblant un conseiller (D6)", () => {
  it("MODEL-API-B: POST /tickets avec targetManagerId conseiller actif → target_manager_id posé", async () => {
    const agentTok = await token("AGENT", ids.managerId, [ids.agencyId]);
    const r = await req("POST", "/tickets", {
      body: { serviceId: ids.serviceId, channel: "KIOSK", targetManagerId: ids.managerId },
      token: agentTok,
      idem: randomUUID(),
    });
    expect(r.status).toBe(201);
    expect((r.data as Record<string, unknown>)["targetManagerId"]).toBe(ids.managerId);
    const row = await db.query(`SELECT target_manager_id FROM tickets WHERE id = $1`, [(r.data as { id: string }).id]);
    expect((row.rows[0] as { target_manager_id: string }).target_manager_id).toBe(ids.managerId);
  });

  it("MODEL-API-B: POST /tickets targetManagerId inconnu → 404 RELATIONSHIP_MANAGER_NOT_FOUND", async () => {
    const agentTok = await token("AGENT", ids.managerId, [ids.agencyId]);
    const r = await req("POST", "/tickets", {
      body: { serviceId: ids.serviceId, channel: "KIOSK", targetManagerId: randomUUID() },
      token: agentTok,
      idem: randomUUID(),
    });
    expect(r.status).toBe(404);
    expect((r.data as { error: { code: string } }).error.code).toBe("RELATIONSHIP_MANAGER_NOT_FOUND");
  });

  it("MODEL-API-B: POST /tickets targetManagerId = agent NON conseiller → 404", async () => {
    const agentTok = await token("AGENT", ids.managerId, [ids.agencyId]);
    const r = await req("POST", "/tickets", {
      body: { serviceId: ids.serviceId, channel: "KIOSK", targetManagerId: ids.agentPlainId },
      token: agentTok,
      idem: randomUUID(),
    });
    expect(r.status).toBe(404);
    expect((r.data as { error: { code: string } }).error.code).toBe("RELATIONSHIP_MANAGER_NOT_FOUND");
  });

  it("MODEL-API-B: POST /tickets targetManagerId conseiller d'une AUTRE agence → 404 (tenant-isolation)", async () => {
    const agentTok = await token("AGENT", ids.managerId, [ids.agencyId]);
    const r = await req("POST", "/tickets", {
      body: { serviceId: ids.serviceId, channel: "KIOSK", targetManagerId: ids.managerBId },
      token: agentTok,
      idem: randomUUID(),
    });
    expect(r.status).toBe(404);
    expect((r.data as { error: { code: string } }).error.code).toBe("RELATIONSHIP_MANAGER_NOT_FOUND");
  });

  it("MODEL-API-B: POST /public/tickets avec targetManagerId conseiller actif → target_manager_id posé", async () => {
    const r = await req("POST", "/public/tickets", {
      body: { serviceId: ids.serviceId, channel: "KIOSK", agencyId: ids.agencyId, targetManagerId: ids.managerId },
      idem: randomUUID(),
    });
    expect(r.status).toBe(201);
    expect((r.data as Record<string, unknown>)["targetManagerId"]).toBe(ids.managerId);
    // L'uuid interne n'est jamais exposé côté public.
    expect((r.data as Record<string, unknown>)["id"]).toBeUndefined();
  });

  it("MODEL-API-B: POST /public/tickets targetManagerId inconnu → 404 opaque RELATIONSHIP_MANAGER_NOT_FOUND", async () => {
    const r = await req("POST", "/public/tickets", {
      body: { serviceId: ids.serviceId, channel: "KIOSK", agencyId: ids.agencyId, targetManagerId: randomUUID() },
      idem: randomUUID(),
    });
    expect(r.status).toBe(404);
    expect((r.data as { error: { code: string } }).error.code).toBe("RELATIONSHIP_MANAGER_NOT_FOUND");
  });
});
