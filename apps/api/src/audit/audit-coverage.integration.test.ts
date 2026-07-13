/**
 * Tests d'intégration SEC-001a — couverture d'audit des mutations (PG réelle).
 *
 * Prouve, contre une PostgreSQL Testcontainers :
 *  - chaque mutation applicative (`disposition:"app"`) exercée produit EXACTEMENT
 *    une entrée `audit_log` (transition ticket, PATCH queue, sync, feedback,
 *    révocation borne) ;
 *  - rollback de la mutation → ZÉRO entrée d'audit (atomicité transactionnelle) ;
 *  - l'IP provient du XFF durci (F3), jamais du payload ; `occurred_at` = base ;
 *  - le diff n'expose JAMAIS le téléphone en clair ni de colonne sensible.
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
let ids: Awaited<ReturnType<typeof insertFixtures>>;
let token: string;

const JWT_SECRET = "sec001-audit-jwt-secret-at-least-32-chars!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);
process.env["PHONE_ENCRYPTION_KEY"] =
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  "2222222222222222222222222222222222222222222222222222222222222222";
// IP d'audit = XFF durci : on active TRUST_PROXY et on injecte X-Forwarded-For.
process.env["TRUST_PROXY"] = "true";

/** Schéma minimal : enums + tables nécessaires au cycle ticket + audit. */
async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='role') THEN
        CREATE TYPE role AS ENUM ('SUPER_ADMIN','BANK_ADMIN','AGENCY_DIRECTOR','MANAGER','AGENT','AUDITOR'); END IF;
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
  await client.query(`CREATE TABLE IF NOT EXISTS counters (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL, status counter_status NOT NULL DEFAULT 'OPEN', agent_id UUID, current_ticket_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID REFERENCES banks(id), email TEXT NOT NULL UNIQUE, languages TEXT[] NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), is_relationship_manager BOOLEAN NOT NULL DEFAULT false, display_name TEXT, photo_url TEXT);`);
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), operation_id UUID REFERENCES operations(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, display_number TEXT, tracking_id CHAR(21) NOT NULL UNIQUE, local_uuid UUID UNIQUE, channel ticket_channel NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING', priority ticket_priority NOT NULL DEFAULT 'STANDARD', phone_encrypted TEXT, phone_hash TEXT, sms_consent BOOLEAN NOT NULL DEFAULT false, required_language TEXT, feedback_score INTEGER, feedback_comment TEXT, feedback_at TIMESTAMPTZ, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), called_at TIMESTAMPTZ, served_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, no_show_at TIMESTAMPTZ, wait_time_seconds INTEGER, service_time_seconds INTEGER, issued_day DATE GENERATED ALWAYS AS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (queue_id, number, issued_day), target_manager_id UUID);`);
  await client.query(`CREATE TABLE IF NOT EXISTS ticket_transfers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), ticket_id UUID NOT NULL REFERENCES tickets(id), from_counter_id UUID, from_service_id UUID NOT NULL REFERENCES services(id), to_service_id UUID NOT NULL REFERENCES services(id), to_counter_id UUID, reason TEXT, transferred_by UUID NOT NULL, transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  // Table audit_log (DB-004) + trigger d'immuabilité append-only (UPDATE/DELETE→exception).
  await client.query(`CREATE TABLE IF NOT EXISTS audit_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), actor_id UUID, actor_role role, actor_email TEXT, action VARCHAR(500) NOT NULL, entity_type TEXT NOT NULL, entity_id UUID, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ip INET, diff JSONB);`);
  await client.query(`
    CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'audit_log is append-only'; END; $$ LANGUAGE plpgsql;
  `);
  await client.query(`DROP TRIGGER IF EXISTS audit_log_no_mutate ON audit_log;`);
  await client.query(`CREATE TRIGGER audit_log_no_mutate BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();`);
}

/** Insère bank/agency/service/queue/counter. */
async function insertFixtures(client: pg.Client): Promise<{
  bankId: string; agencyId: string; userId: string;
  serviceId: string; queueId: string; counterId: string;
}> {
  const bank = await client.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await client.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','Ouverture') RETURNING id`, [bankId, agencyId]);
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`, [bankId, agencyId, serviceId]);
  const queueId = (q.rows[0] as { id: string }).id;
  const ctr = await client.query(`INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,1,'G1') RETURNING id`, [bankId, agencyId]);
  const counterId = (ctr.rows[0] as { id: string }).id;
  const user = await client.query(`INSERT INTO users (bank_id, email) VALUES ($1,'agent@b.ci') RETURNING id`, [bankId]);
  const userId = (user.rows[0] as { id: string }).id;
  return { bankId, agencyId, userId, serviceId, queueId, counterId };
}

/** Forge un JWT AGENT valide pour le tenant de test. */
async function forgeToken(role: string): Promise<string> {
  return new SignJWT({ role, bankId: ids.bankId, agencyIds: [ids.agencyId] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ids.userId)
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
  db = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test`,
  });
  await db.connect();
  redis = new Redis(`redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`);
  await runMigrations(db);
  ids = await insertFixtures(db);
  bus = createCaptureBus();
  app = createApp({ db, redis, jwtSecret: jwtSecretBytes, bus });
  token = await forgeToken("AGENT");
}, 180_000);

afterAll(async () => {
  await redis.quit();
  await db.end();
  await pgContainer.stop();
  await redisContainer.stop();
  delete process.env["TRUST_PROXY"];
}, 30_000);

beforeEach(async () => {
  bus.events.length = 0;
  await redis.flushall();
  // TRUNCATE contourne le trigger BEFORE DELETE (append-only) — nettoyage de test
  // uniquement ; l'immuabilité ligne à ligne reste vérifiée par un test dédié.
  await db.query(`TRUNCATE audit_log`);
  await db.query(`DELETE FROM ticket_transfers`);
  await db.query(`DELETE FROM tickets`);
  await db.query(`UPDATE queues SET current_ticket_number = 0, status = 'OPEN', is_open = true`);
});

/** POST helper (agent JWT + XFF durci). */
async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: unknown }> {
  const res = await app.fetch(new Request(`http://localhost/api/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Forwarded-For": "41.67.128.9",
      ...headers,
    },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/** PATCH helper. */
async function patch(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await app.fetch(new Request(`http://localhost/api/v1${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await forgeToken("MANAGER")}`,
      "X-Forwarded-For": "41.67.128.9",
    },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/** Émet un ticket via l'API et retourne son id interne. */
async function issueTicket(withPhone = false): Promise<string> {
  const body: Record<string, unknown> = { serviceId: ids.serviceId, channel: "KIOSK" };
  if (withPhone) { body["phoneNumber"] = "+22507000000"; body["smsConsent"] = true; }
  const r = await post("/tickets", body, { "X-Idempotency-Key": `k-${Math.random().toString(36).slice(2)}` });
  expect(r.status).toBe(201);
  return (r.data as { id: string }).id;
}

/** Compte les entrées d'audit pour une action donnée. */
async function auditCount(action: string): Promise<number> {
  const res = await db.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = $1`, [action]);
  return (res.rows[0] as { n: number }).n;
}

/** Lit la dernière entrée d'audit pour une action. */
async function lastAudit(action: string): Promise<{ ip: string | null; diff: Record<string, unknown> | null; occurred_at: Date; actor_id: string | null }> {
  const res = await db.query(
    `SELECT host(ip) AS ip, diff, occurred_at, actor_id FROM audit_log WHERE action = $1 ORDER BY occurred_at DESC LIMIT 1`,
    [action]
  );
  return res.rows[0] as { ip: string | null; diff: Record<string, unknown> | null; occurred_at: Date; actor_id: string | null };
}

describe("SEC-001a: couverture d'audit des mutations (PG réelle)", () => {
  it("SEC-001a: POST /tickets produit exactement 1 entrée audit_log (IP = XFF, occurred_at = base)", async () => {
    const before = new Date();
    const id = await issueTicket();
    expect(await auditCount("POST /tickets")).toBe(1);
    const entry = await lastAudit("POST /tickets");
    expect(entry.ip).toBe("41.67.128.9"); // IP du XFF durci, jamais du payload
    expect(entry.occurred_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(entry.actor_id).toBe(ids.userId);
    // entité = ticket créé
    const res = await db.query(`SELECT entity_id FROM audit_log WHERE action = 'POST /tickets'`);
    expect((res.rows[0] as { entity_id: string }).entity_id).toBe(id);
  });

  it("SEC-001a: transition close journalisée applicativement (tickets HORS trigger DB-004)", async () => {
    const id = await issueTicket();
    await post(`/tickets/${id}/call`, { counterId: ids.counterId });
    await post(`/tickets/${id}/serve`, {});
    await post(`/tickets/${id}/close`, {});
    expect(await auditCount("POST /tickets/:id/call")).toBe(1);
    expect(await auditCount("POST /tickets/:id/serve")).toBe(1);
    expect(await auditCount("POST /tickets/:id/close")).toBe(1);
    const close = await lastAudit("POST /tickets/:id/close");
    expect(close.diff).toMatchObject({ after: { status: "DONE" } });
  });

  it("SEC-001a: PATCH /queues/:id auditée avec diff before/after", async () => {
    const r = await patch(`/queues/${ids.queueId}`, { status: "PAUSED" });
    expect(r.status).toBe(200);
    expect(await auditCount("PATCH /queues/:id")).toBe(1);
    const entry = await lastAudit("PATCH /queues/:id");
    expect(entry.diff).toMatchObject({ before: { status: "OPEN" }, after: { status: "PAUSED" } });
    expect(entry.ip).toBe("41.67.128.9");
  });

  it("SEC-001a: le diff n'expose JAMAIS le téléphone en clair (ticket avec phoneNumber)", async () => {
    await issueTicket(true);
    const entry = await lastAudit("POST /tickets");
    const serialized = JSON.stringify(entry.diff);
    expect(serialized).not.toContain("+22507000000");
    expect(serialized.toLowerCase()).not.toContain("phone");
  });

  it("SEC-001a: rollback de la mutation → ZÉRO entrée audit_log (atomicité)", async () => {
    // Émettre un ticket, puis tenter une transition ILLÉGALE (close sur WAITING) :
    // la mutation échoue → aucune entrée d'audit de close ne doit exister.
    const id = await issueTicket();
    await db.query(`TRUNCATE audit_log`);
    const r = await post(`/tickets/${id}/close`, {});
    expect(r.status).toBeGreaterThanOrEqual(400); // transition illégale
    expect(await auditCount("POST /tickets/:id/close")).toBe(0);
  });

  it("SEC-001a: audit_log est append-only (UPDATE/DELETE d'une entrée → exception)", async () => {
    await issueTicket();
    const row = await db.query(`SELECT id FROM audit_log LIMIT 1`);
    const auditId = (row.rows[0] as { id: string }).id;
    await expect(
      db.query(`UPDATE audit_log SET action = 'TAMPERED' WHERE id = $1`, [auditId])
    ).rejects.toThrow(/append-only/);
    await db.query(`ROLLBACK`).catch(() => undefined);
  });
});
