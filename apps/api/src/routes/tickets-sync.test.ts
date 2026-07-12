/**
 * Tests d'intégration — API-005 : sync offline (batch borné idempotent).
 *
 * PG 16 + Redis 7 réels (Testcontainers). Nommage strict : `API-005: <description>`.
 * Couvre les 7 critères d'acceptation de la story :
 *  - batch 100 OK / 101 → 422 BATCH_TOO_LARGE
 *  - rejeu 2× et 3× → réponses identiques, zéro doublon
 *  - numéros définitifs ordonnés par createdOfflineAt ; mapping complet
 *  - CLOCK_SKEW / SERVICE_NOT_FOUND → skipped ciblé, reste synchronisé
 *  - un seul queue:updated par file
 *  - batch avec skipped → alert:manager KIOSK_SYSTEM_ERROR (une par batch)
 *  - idempotence unitaire par localUuid (ALREADY_SYNCED)
 *  - isolation tenant (bank/agence).
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { SignJWT } from "jose";
import { createApp } from "src/app.js";
import { createCaptureBus, type CaptureBus } from "src/services/realtime.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let bus: CaptureBus;
let app: ReturnType<typeof createApp>;
let ids: Fixtures;
let token: string;

const JWT_SECRET = "tickets-sync-jwt-secret-at-least-32-chars!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);
process.env["PHONE_ENCRYPTION_KEY"] =
  process.env["PHONE_ENCRYPTION_KEY"] ??
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  process.env["PHONE_HASH_KEY"] ??
  "2222222222222222222222222222222222222222222222222222222222222222";

interface Fixtures {
  bankId: string;
  agencyId: string;
  userId: string;
  serviceId: string;
  queueId: string;
  service2Id: string;
  queue2Id: string;
  otherBankId: string;
  otherAgencyId: string;
  otherServiceId: string;
}

/** Crée le schéma minimal (avec local_uuid unique — couture DB DB-001). */
async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_status') THEN
        CREATE TYPE ticket_status AS ENUM ('WAITING','CALLED','SERVING','DONE','NO_SHOW','ABANDONED','TRANSFERRED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_priority') THEN
        CREATE TYPE ticket_priority AS ENUM ('STANDARD','PRIORITY','VIP','PMR','SENIOR'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_channel') THEN
        CREATE TYPE ticket_channel AS ENUM ('KIOSK','QR','MOBILE','WHATSAPP'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='queue_status') THEN
        CREATE TYPE queue_status AS ENUM ('OPEN','PAUSED','CLOSED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='counter_status') THEN
        CREATE TYPE counter_status AS ENUM ('OPEN','PAUSED','CLOSED'); END IF;
    END $$;
  `);
  await client.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, no_show_timeout_minutes INTEGER NOT NULL DEFAULT 3, queue_critical_threshold INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS operations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), code VARCHAR(6) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER, display_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, icon_key TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(service_id, code));`);
  await client.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), current_ticket_number INTEGER NOT NULL DEFAULT 0, is_open BOOLEAN NOT NULL DEFAULT true, status queue_status NOT NULL DEFAULT 'OPEN', open_at TEXT, close_at TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), operation_id UUID REFERENCES operations(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, display_number TEXT, tracking_id CHAR(21) NOT NULL UNIQUE, local_uuid UUID UNIQUE, channel ticket_channel NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING', priority ticket_priority NOT NULL DEFAULT 'STANDARD', phone_encrypted TEXT, phone_hash TEXT, sms_consent BOOLEAN NOT NULL DEFAULT false, required_language TEXT, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), called_at TIMESTAMPTZ, served_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, no_show_at TIMESTAMPTZ, wait_time_seconds INTEGER, service_time_seconds INTEGER, issued_day DATE GENERATED ALWAYS AS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (queue_id, number, issued_day));`);
}

/** Insère deux banques/agences/services distinctes pour l'isolation tenant. */
async function insertFixtures(client: pg.Client): Promise<Fixtures> {
  const bank = await client.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await client.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','Ouverture') RETURNING id`, [bankId, agencyId]);
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`, [bankId, agencyId, serviceId]);
  const queueId = (q.rows[0] as { id: string }).id;
  const svc2 = await client.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'CR','Credit') RETURNING id`, [bankId, agencyId]);
  const service2Id = (svc2.rows[0] as { id: string }).id;
  const q2 = await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`, [bankId, agencyId, service2Id]);
  const queue2Id = (q2.rows[0] as { id: string }).id;

  const other = await client.query(`INSERT INTO banks (name, slug) VALUES ('OB','ob') RETURNING id`);
  const otherBankId = (other.rows[0] as { id: string }).id;
  const oa = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'OA') RETURNING id`, [otherBankId]);
  const otherAgencyId = (oa.rows[0] as { id: string }).id;
  const os = await client.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'XX','Autre') RETURNING id`, [otherBankId, otherAgencyId]);
  const otherServiceId = (os.rows[0] as { id: string }).id;
  await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3)`, [otherBankId, otherAgencyId, otherServiceId]);

  const userId = "99999999-9999-4999-a999-999999999999";
  return { bankId, agencyId, userId, serviceId, queueId, service2Id, queue2Id, otherBankId, otherAgencyId, otherServiceId };
}

/** Forge un JWT AGENT pour un tenant/agence donné. */
async function forgeToken(bankId: string, agencyId: string): Promise<string> {
  return new SignJWT({ role: "AGENT", bankId, agencyIds: [agencyId] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("99999999-9999-4999-a999-999999999999")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(jwtSecretBytes);
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
  redis = new Redis(`redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`);
  await runMigrations(db);
  ids = await insertFixtures(db);
  bus = createCaptureBus();
  app = createApp({ db, redis, jwtSecret: jwtSecretBytes, bus });
  token = await forgeToken(ids.bankId, ids.agencyId);
}, 180_000);

afterAll(async () => {
  await redis.quit();
  await db.end();
  await pgContainer.stop();
  await redisContainer.stop();
}, 30_000);

beforeEach(async () => {
  bus.events.length = 0;
  await redis.flushall();
  await db.query(`DELETE FROM tickets`);
  await db.query(`UPDATE queues SET current_ticket_number = 0`);
});

/** Compteur monotone pour des clés d'idempotence uniques. */
let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `sync-key-${keySeq}-${Date.now()}`;
}

/** POST /tickets/sync avec headers optionnels. */
async function sync(
  body: unknown,
  headers: Record<string, string> = {},
  authToken = token
): Promise<{ status: number; data: unknown }> {
  const res = await app.fetch(
    new Request(`http://localhost/api/v1/tickets/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, ...headers },
      body: JSON.stringify(body),
    })
  );
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/** Génère un UUID v4 côté test. */
function uuid(): string {
  return crypto.randomUUID();
}

/** Construit un item de sync minimal valide. */
function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { localUuid: uuid(), serviceId: ids.serviceId, channel: "KIOSK", createdOfflineAt: "2026-07-11T07:00:00.000Z", ...overrides };
}

interface SyncBody {
  synced: Array<{ localUuid: string; serverId: string; number: string }>;
  skipped: Array<{ localUuid: string; reason: string }>;
}

describe("API-005: sync offline", () => {
  it("API-005: batch 100 OK ; 101 → 422 BATCH_TOO_LARGE", async () => {
    const tickets100 = Array.from({ length: 100 }, () => item());
    const ok = await sync({ tickets: tickets100 }, { "X-Idempotency-Key": nextKey() });
    expect(ok.status).toBe(200);
    expect((ok.data as SyncBody).synced).toHaveLength(100);

    const tickets101 = Array.from({ length: 101 }, () => item());
    const tooBig = await sync({ tickets: tickets101 }, { "X-Idempotency-Key": nextKey() });
    expect(tooBig.status).toBe(422);
    const err = (tooBig.data as { error: { code: string; details: { maxItems: number; receivedItems: number } } }).error;
    expect(err.code).toBe("BATCH_TOO_LARGE");
    expect(err.details).toEqual({ maxItems: 100, receivedItems: 101 });
  });

  it("API-005: X-Idempotency-Key absent → 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const r = await sync({ tickets: [item()] });
    expect(r.status).toBe(400);
    expect((r.data as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("API-005: même clé + payload différent → 409 IDEMPOTENCY_CONFLICT", async () => {
    const key = nextKey();
    await sync({ tickets: [item()] }, { "X-Idempotency-Key": key });
    const conflict = await sync({ tickets: [item()] }, { "X-Idempotency-Key": key });
    expect(conflict.status).toBe(409);
    expect((conflict.data as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("API-005: rejeu du même batch (2× et 3×) → réponses identiques, zéro doublon en base", async () => {
    const key = nextKey();
    const batch = { tickets: [item(), item(), item()] };
    const r1 = await sync(batch, { "X-Idempotency-Key": key });
    const r2 = await sync(batch, { "X-Idempotency-Key": key });
    const r3 = await sync(batch, { "X-Idempotency-Key": key });
    expect(r1.status).toBe(200);
    expect(JSON.stringify(r1.data)).toBe(JSON.stringify(r2.data));
    expect(JSON.stringify(r1.data)).toBe(JSON.stringify(r3.data));
    const count = await db.query(`SELECT COUNT(*)::int AS n FROM tickets`);
    expect((count.rows[0] as { n: number }).n).toBe(3);
  });

  it("API-005: localUuid déjà connu → skipped ALREADY_SYNCED sur clé distincte", async () => {
    const shared = item();
    const first = await sync({ tickets: [shared] }, { "X-Idempotency-Key": nextKey() });
    expect((first.data as SyncBody).synced).toHaveLength(1);
    // Nouvelle clé d'idempotence, même localUuid → skipped ALREADY_SYNCED
    const second = await sync({ tickets: [shared] }, { "X-Idempotency-Key": nextKey() });
    const body = second.data as SyncBody;
    expect(body.synced).toHaveLength(0);
    expect(body.skipped).toEqual([{ localUuid: shared["localUuid"], reason: "ALREADY_SYNCED" }]);
    const count = await db.query(`SELECT COUNT(*)::int AS n FROM tickets`);
    expect((count.rows[0] as { n: number }).n).toBe(1);
  });

  it("API-005: numéros définitifs ordonnés par createdOfflineAt ; mapping complet retourné", async () => {
    const late = item({ createdOfflineAt: "2026-07-11T09:00:00.000Z" });
    const early = item({ createdOfflineAt: "2026-07-11T07:00:00.000Z" });
    const mid = item({ createdOfflineAt: "2026-07-11T08:00:00.000Z" });
    // Ordre d'envoi volontairement mélangé
    const r = await sync({ tickets: [late, early, mid] }, { "X-Idempotency-Key": nextKey() });
    const body = r.data as SyncBody;
    expect(body.synced).toHaveLength(3);
    const byUuid = new Map(body.synced.map((s) => [s.localUuid, s.number]));
    // early < mid < late en numéro serveur
    const nEarly = byUuid.get(early["localUuid"] as string)!;
    const nMid = byUuid.get(mid["localUuid"] as string)!;
    const nLate = byUuid.get(late["localUuid"] as string)!;
    expect(nEarly < nMid).toBe(true);
    expect(nMid < nLate).toBe(true);
    // serverId présent et non vide pour tous
    for (const s of body.synced) expect(s.serverId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("API-005: skew horloge (CLOCK_SKEW) / service inconnu (SERVICE_NOT_FOUND) → skipped ciblé, le reste synchronisé", async () => {
    const future = item({ createdOfflineAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    const unknownService = item({ serviceId: uuid() });
    const good = item();
    const r = await sync(
      { tickets: [future, unknownService, good] },
      { "X-Idempotency-Key": nextKey() }
    );
    const body = r.data as SyncBody;
    expect(body.synced.map((s) => s.localUuid)).toEqual([good["localUuid"]]);
    const reasons = new Map(body.skipped.map((s) => [s.localUuid, s.reason]));
    expect(reasons.get(future["localUuid"] as string)).toBe("CLOCK_SKEW");
    expect(reasons.get(unknownService["localUuid"] as string)).toBe("SERVICE_NOT_FOUND");
  });

  it("API-005: un seul queue:updated par file affectée", async () => {
    // 3 tickets service 1 + 2 tickets service 2 → 2 files → 2 queue:updated
    const r = await sync(
      {
        tickets: [
          item(),
          item(),
          item(),
          item({ serviceId: ids.service2Id }),
          item({ serviceId: ids.service2Id }),
        ],
      },
      { "X-Idempotency-Key": nextKey() }
    );
    expect(r.status).toBe(200);
    const queueEvents = bus.ofType("queue:updated");
    expect(queueEvents).toHaveLength(2);
    const queueIds = queueEvents.map((e) => (e.payload as { queueId: string }).queueId).sort();
    expect(queueIds).toEqual([ids.queueId, ids.queue2Id].sort());
  });

  it("API-005: batch avec skipped → alert:manager KIOSK_SYSTEM_ERROR émis par le serveur (une par batch, payload compte+raisons)", async () => {
    const future = item({ createdOfflineAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    const unknownService = item({ serviceId: uuid() });
    const good = item();
    await sync({ tickets: [future, unknownService, good] }, { "X-Idempotency-Key": nextKey() });
    const alerts = bus.ofType("alert:manager");
    expect(alerts).toHaveLength(1);
    const payload = alerts[0]!.payload as { type: string; payload: { skippedCount: number; reasons: Record<string, number> } };
    expect(payload.type).toBe("KIOSK_SYSTEM_ERROR");
    expect(payload.payload.skippedCount).toBe(2);
    expect(payload.payload.reasons).toEqual({ CLOCK_SKEW: 1, SERVICE_NOT_FOUND: 1 });
  });

  it("API-005: aucun skipped → aucun alert:manager", async () => {
    await sync({ tickets: [item(), item()] }, { "X-Idempotency-Key": nextKey() });
    expect(bus.ofType("alert:manager")).toHaveLength(0);
  });

  it("API-005: tickets synchronisés en statut WAITING", async () => {
    await sync({ tickets: [item()] }, { "X-Idempotency-Key": nextKey() });
    const res = await db.query(`SELECT status FROM tickets`);
    expect((res.rows[0] as { status: string }).status).toBe("WAITING");
  });

  it("API-005: batch vide → 400 (minItems 1)", async () => {
    const r = await sync({ tickets: [] }, { "X-Idempotency-Key": nextKey() });
    expect(r.status).toBe(400);
  });

  it("API-005: item avec champ inconnu → 400 (additionalProperties false)", async () => {
    const r = await sync(
      { tickets: [item({ localNumber: 12, phone: "+2250700000000" })] },
      { "X-Idempotency-Key": nextKey() }
    );
    expect(r.status).toBe(400);
  });

  it("API-005: isolation tenant — service d'une autre banque → SERVICE_NOT_FOUND (jamais synchronisé)", async () => {
    // Le token appartient à ids.bank ; on tente de sync un service d'otherBank.
    const foreign = item({ serviceId: ids.otherServiceId });
    const r = await sync({ tickets: [foreign] }, { "X-Idempotency-Key": nextKey() });
    const body = r.data as SyncBody;
    expect(body.synced).toHaveLength(0);
    expect(body.skipped[0]!.reason).toBe("SERVICE_NOT_FOUND");
    // Rien inséré dans le tenant courant pour ce service étranger
    const count = await db.query(`SELECT COUNT(*)::int AS n FROM tickets WHERE service_id = $1`, [ids.otherServiceId]);
    expect((count.rows[0] as { n: number }).n).toBe(0);
  });

  it("API-005: isolation tenant — token d'une autre agence ne peut pas sync le service courant", async () => {
    const otherToken = await forgeToken(ids.otherBankId, ids.otherAgencyId);
    const r = await sync({ tickets: [item()] }, { "X-Idempotency-Key": nextKey() }, otherToken);
    const body = r.data as SyncBody;
    // Le service ids.serviceId n'est pas dans le scope de l'autre agence → SERVICE_NOT_FOUND
    expect(body.synced).toHaveLength(0);
    expect(body.skipped[0]!.reason).toBe("SERVICE_NOT_FOUND");
  });
});

/** Crée une opération active sous un service du tenant courant. */
async function seedOperation(serviceId: string, code: string): Promise<string> {
  return (await db.query(
    `INSERT INTO operations (bank_id, agency_id, service_id, code, name, sla_minutes, display_order)
     VALUES ($1,$2,$3,$4,'Op',NULL,0) RETURNING id`,
    [ids.bankId, ids.agencyId, serviceId, code]
  )).rows[0].id as string;
}

describe("MODEL-API-A: résolution operationId par item (POST /tickets/sync)", () => {
  it("MODEL-API-A: item avec operationId → synced + service_id dérivé + operation_id posé", async () => {
    const opId = await seedOperation(ids.serviceId, "DEP");
    const it = item({ operationId: opId });
    const r = await sync({ tickets: [it] }, { "X-Idempotency-Key": nextKey() });
    const body = r.data as SyncBody;
    expect(body.synced).toHaveLength(1);
    const row = (await db.query(`SELECT service_id, operation_id FROM tickets WHERE local_uuid=$1`, [it["localUuid"]])).rows[0] as { service_id: string; operation_id: string };
    expect(row.service_id).toBe(ids.serviceId);
    expect(row.operation_id).toBe(opId);
  });

  it("MODEL-API-A: item operationId inconnu → skipped OPERATION_NOT_FOUND", async () => {
    const it = item({ operationId: uuid() });
    const r = await sync({ tickets: [it] }, { "X-Idempotency-Key": nextKey() });
    const body = r.data as SyncBody;
    expect(body.synced).toHaveLength(0);
    expect(body.skipped[0]!.reason).toBe("OPERATION_NOT_FOUND");
  });

  it("MODEL-API-A: item mismatch serviceId/operationId → skipped SERVICE_OPERATION_MISMATCH", async () => {
    const opId = await seedOperation(ids.serviceId, "MIS");
    const it = item({ serviceId: ids.service2Id, operationId: opId });
    const r = await sync({ tickets: [it] }, { "X-Idempotency-Key": nextKey() });
    const body = r.data as SyncBody;
    expect(body.synced).toHaveLength(0);
    expect(body.skipped[0]!.reason).toBe("SERVICE_OPERATION_MISMATCH");
  });
});
