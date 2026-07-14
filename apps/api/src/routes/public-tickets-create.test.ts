/**
 * Tests d'intégration — POST /public/tickets (émission borne PUBLIQUE, couture RT-003).
 *
 * PostgreSQL 16 + Redis 7 réels (Testcontainers). Aucune authentification :
 * cette route est PUBLIQUE (sans JWT) ; l'agence/service viennent du CORPS.
 *
 * Critères couverts :
 * - `PUBLIC-TICKETS: sans JWT → 201 ticket public (trackingId nanoid, sans uuid interne)`
 * - `PUBLIC-TICKETS: X-Idempotency-Key requis → 400 ; rejeu byte-identique`
 * - `PUBLIC-TICKETS: rate-limit dépassé → 429 + Retry-After (IP via TRUST_PROXY)`
 * - `PUBLIC-TICKETS: service inconnu/inactif → 4xx conforme`
 * - `PUBLIC-TICKETS: tenant-isolation — ticket dans le bon bank/agence`
 * - `PUBLIC-TICKETS: zéro fuite d'uuid interne`
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { randomUUID } from "node:crypto";
import { applyMigrations } from "@sigfa/database/test-support";
import type { PostgresHarness } from "@sigfa/testing/tenant-isolation";
import { createApp } from "src/app.js";

process.env["PHONE_ENCRYPTION_KEY"] =
  process.env["PHONE_ENCRYPTION_KEY"] ??
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  process.env["PHONE_HASH_KEY"] ??
  "2222222222222222222222222222222222222222222222222222222222222222";
process.env["TRUST_PROXY"] = "true";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let app: ReturnType<typeof createApp>;

/** Tenant A (banque cible). */
let bankId: string;
let agencyId: string;
let serviceId: string;
/** Tenant B (banque distincte) — piège d'isolation. */
let otherBankId: string;
let otherAgencyId: string;
let otherServiceId: string;
/** Service dont la file est fermée (CLOSED). */
let pausedServiceId: string;

const jwtSecretBytes = new TextEncoder().encode("public-create-secret-32-chars-long!!!!");

/**
 * Applique les VRAIES migrations SQL (`packages/database/migrations/`) sur la base
 * de test — FIDÉLITÉ au schéma de production (même convention que
 * `schemathesis-public.test.ts` / `armed-tenant.integration.test.ts`). Un DDL inline
 * déclarait `tickets.required_language` en `VARCHAR(10)` : le vrai schéma le type en
 * enum `agent_language` (FR/EN — migrations 0008+0011). Le drift est désormais
 * structurellement impossible : le schéma exercé EST celui des migrations (enum réel,
 * RLS `tenant_isolation` ENABLE/FORCE + policies (0001), vrai `audit_log` (0003),
 * unicité `(queue_id, number, issued_day)`, CHECK `channel` NOT NULL sans défaut).
 *
 * La connexion applicative est le rôle `sigfa` (superuser Testcontainers) : il
 * contourne FORCE RLS, donc la résolution PRÉ-TENANT légitime (bankId dérivé de
 * l'`agencyId` du corps, avant armement) reste fonctionnelle — comme en production
 * sur le chemin pré-résolution. L'isolation RLS armée POST-résolution est prouvée
 * séparément par `config-cutover-lot7-tenant-isolation.integration.test.ts`
 * (`sigfa_app` NOBYPASSRLS), hors périmètre de ce test fonctionnel de route.
 */
async function runMigrations(client: pg.Client): Promise<void> {
  const harness: PostgresHarness = {
    connectionString: "",
    query: async (sql: string, values?: unknown[]) => {
      const res =
        values !== undefined ? await client.query(sql, values) : await client.query(sql);
      return { rows: res.rows as Array<Record<string, unknown>> };
    },
    stop: async () => {},
  };
  await applyMigrations(harness);
}

/** POST /public/tickets avec IP simulée + clé d'idempotence optionnelle. */
async function postTicket(
  body: unknown,
  opts: { ip?: string; idem?: string | null } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": opts.ip ?? "10.0.0.1",
  };
  if (opts.idem !== null) headers["X-Idempotency-Key"] = opts.idem ?? randomUUID();
  return app.request("/api/v1/public/tickets", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
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
  db = new pg.Client({ connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test` });
  await db.connect();
  await runMigrations(db);
  redis = new Redis(`redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`);

  // Tenant A
  bankId = (await db.query(`INSERT INTO banks (name, slug) VALUES ('BankA','bank-a') RETURNING id`)).rows[0].id;
  agencyId = (await db.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'AgA') RETURNING id`, [bankId])).rows[0].id;
  serviceId = (await db.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','Ouverture') RETURNING id`, [bankId, agencyId])).rows[0].id;
  await db.query(`INSERT INTO queues (bank_id, agency_id, service_id, status) VALUES ($1,$2,$3,'OPEN')`, [bankId, agencyId, serviceId]);

  // Service dont la file est CLOSED
  pausedServiceId = (await db.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'CL','Clos') RETURNING id`, [bankId, agencyId])).rows[0].id;
  await db.query(`INSERT INTO queues (bank_id, agency_id, service_id, status) VALUES ($1,$2,$3,'CLOSED')`, [bankId, agencyId, pausedServiceId]);

  // Tenant B (distinct)
  otherBankId = (await db.query(`INSERT INTO banks (name, slug) VALUES ('BankB','bank-b') RETURNING id`)).rows[0].id;
  otherAgencyId = (await db.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'AgB') RETURNING id`, [otherBankId])).rows[0].id;
  otherServiceId = (await db.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'VS','Versement') RETURNING id`, [otherBankId, otherAgencyId])).rows[0].id;
  await db.query(`INSERT INTO queues (bank_id, agency_id, service_id, status) VALUES ($1,$2,$3,'OPEN')`, [otherBankId, otherAgencyId, otherServiceId]);

  app = createApp({ db, redis, jwtSecret: jwtSecretBytes });
}, 180_000);

afterAll(async () => {
  await redis.quit();
  await db.end();
  await pgContainer.stop();
  await redisContainer.stop();
}, 30_000);

beforeEach(async () => {
  await redis.flushall();
});

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const NANOID_RE = /^[A-Za-z0-9_-]{21}$/;

describe("PUBLIC-TICKETS: émission borne publique (POST /public/tickets)", () => {
  it("PUBLIC-TICKETS: sans JWT → 201 ticket public (trackingId nanoid, sans uuid interne)", async () => {
    const res = await postTicket({ channel: "KIOSK", serviceId, agencyId, priority: "STANDARD" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("WAITING");
    expect(body["channel"]).toBe("KIOSK");
    expect(body["serviceId"]).toBe(serviceId);
    expect(body["agencyId"]).toBe(agencyId);
    expect(NANOID_RE.test(String(body["trackingId"]))).toBe(true);
    expect(typeof body["number"]).toBe("string");
    expect(typeof body["displayNumber"]).toBe("string");
    expect(typeof body["position"]).toBe("number");
    expect(typeof body["estimatedWaitMinutes"]).toBe("number");
    // Zéro fuite d'uuid interne : aucune propriété `id`, aucun uuid au-delà de service/agency.
    expect(body["id"]).toBeUndefined();
    const scrubbed = JSON.stringify(body).replace(serviceId, "").replace(agencyId, "");
    expect(UUID_RE.test(scrubbed)).toBe(false);
  });

  it("PUBLIC-TICKETS: X-Idempotency-Key absent → 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const res = await postTicket({ channel: "KIOSK", serviceId, agencyId }, { idem: null });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("PUBLIC-TICKETS: même clé + même payload → rejeu byte-identique", async () => {
    const idem = randomUUID();
    const payload = { channel: "KIOSK", serviceId, agencyId };
    const first = await postTicket(payload, { idem });
    const second = await postTicket(payload, { idem });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await first.text()).toBe(await second.text());
  });

  it("PUBLIC-TICKETS: même clé + payload différent → 409 IDEMPOTENCY_CONFLICT", async () => {
    const idem = randomUUID();
    await postTicket({ channel: "KIOSK", serviceId, agencyId }, { idem });
    const res = await postTicket({ channel: "QR", serviceId, agencyId, phoneNumber: "+2250700000001", smsConsent: true }, { idem });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("PUBLIC-TICKETS: service inconnu → 404 conforme", async () => {
    const res = await postTicket({ channel: "KIOSK", serviceId: randomUUID(), agencyId });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("PUBLIC-TICKETS: file du service fermée (CLOSED) → 422 QUEUE_PAUSED", async () => {
    const res = await postTicket({ channel: "KIOSK", serviceId: pausedServiceId, agencyId });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("QUEUE_PAUSED");
  });

  it("PUBLIC-TICKETS: corps invalide (channel manquant) → 400 VALIDATION_ERROR", async () => {
    const res = await postTicket({ serviceId, agencyId });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("PUBLIC-TICKETS: rate-limit dépassé → 429 + Retry-After (IP via TRUST_PROXY)", async () => {
    const ip = "203.0.113.77";
    let sawTooMany = false;
    for (let i = 0; i < 62; i++) {
      const res = await postTicket({ channel: "KIOSK", serviceId, agencyId }, { ip });
      if (res.status === 429) {
        sawTooMany = true;
        expect(res.headers.get("Retry-After")).toBeTruthy();
        break;
      }
    }
    expect(sawTooMany).toBe(true);
  });
});

describe("PUBLIC-TICKETS: tenant-isolation", () => {
  it("PUBLIC-TICKETS: ticket atterrit dans le bon bank/agence (déduit de la file)", async () => {
    const res = await postTicket({ channel: "MOBILE", serviceId, agencyId, phoneNumber: "+2250700000009", smsConsent: true });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { trackingId: string };
    const row = (await db.query(`SELECT bank_id, agency_id FROM tickets WHERE tracking_id = $1`, [body.trackingId])).rows[0] as { bank_id: string; agency_id: string };
    expect(row.bank_id).toBe(bankId);
    expect(row.agency_id).toBe(agencyId);
    expect(row.bank_id).not.toBe(otherBankId);
  });

  it("PUBLIC-TICKETS: service d'une autre agence (mismatch) → 404 (pas de fuite)", async () => {
    // serviceId de la banque A + agencyId de la banque B → aucune file appariée.
    const res = await postTicket({ channel: "KIOSK", serviceId, agencyId: otherAgencyId });
    expect(res.status).toBe(404);
  });
});

/** Crée une opération active sous un service (tenant A). */
async function seedOperation(code: string, slaMinutes: number | null): Promise<string> {
  return (await db.query(
    `INSERT INTO operations (bank_id, agency_id, service_id, code, name, sla_minutes, display_order)
     VALUES ($1,$2,$3,$4,'Op',$5,0) RETURNING id`,
    [bankId, agencyId, serviceId, code, slaMinutes]
  )).rows[0].id as string;
}

describe("MODEL-API-A: création publique par opération + liste publique operations", () => {
  it("MODEL-API-A: POST /public/tickets avec operationId → ticket dans le bon service + operation_id posé", async () => {
    const opId = await seedOperation("DEP", 8);
    const res = await postTicket({ channel: "KIOSK", serviceId, operationId: opId, agencyId });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { trackingId: string; serviceId: string; operationId: string };
    expect(body.serviceId).toBe(serviceId);
    expect(body.operationId).toBe(opId);
    const row = (await db.query(`SELECT operation_id FROM tickets WHERE tracking_id=$1`, [body.trackingId])).rows[0] as { operation_id: string };
    expect(row.operation_id).toBe(opId);
  });

  it("MODEL-API-A: POST /public/tickets operationId inconnu → 404 (opaque)", async () => {
    const res = await postTicket({ channel: "KIOSK", serviceId, operationId: randomUUID(), agencyId });
    expect(res.status).toBe(404);
  });

  it("MODEL-API-A: POST /public/tickets mismatch serviceId/operationId → 422 SERVICE_OPERATION_MISMATCH", async () => {
    const opId = await seedOperation("MIS", null);
    const res = await postTicket({ channel: "KIOSK", serviceId: pausedServiceId, operationId: opId, agencyId });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SERVICE_OPERATION_MISMATCH");
  });

  it("MODEL-API-A: GET /public/agencies/:agencyId/operations?serviceId= → actives + slaMinutes RÉSOLU", async () => {
    await seedOperation("R1", 20); // SLA propre → 20
    await seedOperation("R2", null); // hérite du service (10)
    const inactive = await seedOperation("R3", 5);
    await db.query(`UPDATE operations SET is_active=false WHERE id=$1`, [inactive]);
    const res = await app.request(`/api/v1/public/agencies/${agencyId}/operations?serviceId=${serviceId}`, {
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ code: string; slaMinutes: number }> };
    const byCode = new Map(body.data.map((o) => [o.code, o.slaMinutes]));
    expect(byCode.get("R1")).toBe(20);
    expect(byCode.get("R2")).toBe(10); // SLA résolu = service.sla_minutes
    expect(byCode.has("R3")).toBe(false); // inactive exclue
  });
});
