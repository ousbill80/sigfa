/**
 * Tests d'intégration — API-007 : anti-flap socket par agentId +
 * AGENT_DISCONNECTED_WITH_TICKET (Testcontainers PG16 + Redis 7 réels).
 *
 * Couvre critères 4, 5 :
 *  - anti-flap : `SET NX` TTL grâce ; reconnexion < grâce → DEL, aucun effet ;
 *  - au-delà : ticket CALLED/SERVING → WAITING PRIORITY + counter:status OFFLINE
 *    + alerte + history ; sans ticket → OFFLINE simple.
 *
 * Nommage strict : `API-007: <description>`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { createCaptureBus, type CaptureBus } from "src/services/realtime.js";
import {
  markDisconnect,
  cancelDisconnect,
  processDisconnect,
  graceKey,
  GRACE_TTL_BUFFER_MS,
} from "src/services/agent-disconnect.js";
import { getCurrentStatus } from "src/services/agent-status.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let bus: CaptureBus;
let ids: { bankId: string; agencyId: string; agentId: string; serviceId: string; queueId: string; counterId: string };

async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='agent_status') THEN
        CREATE TYPE agent_status AS ENUM ('AVAILABLE','SERVING','PAUSED','ABSENT','OFFLINE'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_status') THEN
        CREATE TYPE ticket_status AS ENUM ('WAITING','CALLED','SERVING','DONE','NO_SHOW','ABANDONED','TRANSFERRED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_priority') THEN
        CREATE TYPE ticket_priority AS ENUM ('STANDARD','PRIORITY','VIP','PMR','SENIOR'); END IF;
    END $$;
  `);
  await client.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID REFERENCES banks(id), email TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'AGENT', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agency_users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), user_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(agency_id, user_id));`);
  await client.query(`CREATE TABLE IF NOT EXISTS counters (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL, agent_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING', priority ticket_priority NOT NULL DEFAULT 'STANDARD', called_at TIMESTAMPTZ, served_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agent_status_history (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), agent_id UUID NOT NULL REFERENCES users(id), from_status agent_status, to_status agent_status NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
}

async function insertFixtures(client: pg.Client): Promise<typeof ids> {
  const bank = await client.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await client.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','O') RETURNING id`, [bankId, agencyId]);
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`, [bankId, agencyId, serviceId]);
  const queueId = (q.rows[0] as { id: string }).id;
  const user = await client.query(`INSERT INTO users (bank_id, email) VALUES ($1,'agent@b.ci') RETURNING id`, [bankId]);
  const agentId = (user.rows[0] as { id: string }).id;
  await client.query(`INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`, [bankId, agencyId, agentId]);
  const ctr = await client.query(`INSERT INTO counters (bank_id, agency_id, number, label, agent_id) VALUES ($1,$2,1,'G1',$3) RETURNING id`, [bankId, agencyId, agentId]);
  const counterId = (ctr.rows[0] as { id: string }).id;
  return { bankId, agencyId, agentId, serviceId, queueId, counterId };
}

async function setStatus(status: string): Promise<void> {
  await db.query(`INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status) VALUES ($1,$2,$3,$4)`, [ids.bankId, ids.agencyId, ids.agentId, status]);
}

async function insertOpenTicket(status: "CALLED" | "SERVING"): Promise<string> {
  const r = await db.query(
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, counter_id, agent_id, number, status, priority, called_at)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7,'STANDARD',NOW()) RETURNING id`,
    [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, ids.counterId, ids.agentId, status]
  );
  return (r.rows[0] as { id: string }).id;
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
  await db.query(`DELETE FROM agent_status_history`);
  delete process.env["AGENT_DISCONNECT_GRACE_S"];
});

describe("API-007: anti-flap agentId — Redis SET NX TTL 30 s ; reconnexion <30 s → DEL, aucun effet ; >30 s → WAITING PRIORITY + alerte + history (Testcontainers Redis)", () => {
  it("API-007: déconnexion → SET NX pose la clé anti-flap avec TTL couvrant la grâce (30 s + tampon)", async () => {
    const posed = await markDisconnect(redis, ids.agentId);
    expect(posed).toBe(true);
    const ttl = await redis.pttl(graceKey(ids.agentId));
    expect(ttl).toBeGreaterThan(30_000);
    expect(ttl).toBeLessThanOrEqual(30_000 + GRACE_TTL_BUFFER_MS);
    // Idempotent : une 2ᵉ déconnexion rapprochée n'écrase pas la marque (NX).
    expect(await markDisconnect(redis, ids.agentId)).toBe(false);
  });

  it("API-007: reconnexion dans la fenêtre → DEL → traitement sans effet (aucune alerte, statut inchangé)", async () => {
    await setStatus("SERVING");
    await insertOpenTicket("SERVING");
    await markDisconnect(redis, ids.agentId);

    // Reconnexion → annule la déconnexion en attente.
    const cancelled = await cancelDisconnect(redis, ids.agentId);
    expect(cancelled).toBe(true);

    const outcome = await processDisconnect({ db, redis, bus, bankId: ids.bankId, agentId: ids.agentId });
    expect(outcome.processed).toBe(false);
    expect(bus.ofType("alert:manager")).toHaveLength(0);
    expect(await getCurrentStatus(db, ids.agentId)).toBe("SERVING");
  });

  it("API-007: au-delà de la grâce, agent avec ticket SERVING → ticket WAITING PRIORITY + alerte + counter:status + OFFLINE (history)", async () => {
    await setStatus("SERVING");
    const ticketId = await insertOpenTicket("SERVING");
    await markDisconnect(redis, ids.agentId);

    const outcome = await processDisconnect({ db, redis, bus, bankId: ids.bankId, agentId: ids.agentId });
    expect(outcome.processed).toBe(true);
    expect(outcome.requeuedTicketId).toBe(ticketId);

    const t = await db.query(`SELECT status, priority, counter_id, agent_id FROM tickets WHERE id = $1`, [ticketId]);
    expect(t.rows[0]).toMatchObject({ status: "WAITING", priority: "PRIORITY", counter_id: null, agent_id: null });

    const alert = bus.ofType("alert:manager")[0]?.payload as { type: string; payload: Record<string, unknown> };
    expect(alert.type).toBe("AGENT_DISCONNECTED_WITH_TICKET");
    expect(alert.payload["ticketId"]).toBe(ticketId);

    const counter = bus.ofType("counter:status")[0]?.payload as { status: string };
    expect(counter.status).toBe("CLOSED"); // OFFLINE → guichet CLOSED (LA LOI)

    expect(await getCurrentStatus(db, ids.agentId)).toBe("OFFLINE");
    const hist = await db.query(`SELECT to_status FROM agent_status_history WHERE agent_id = $1 ORDER BY changed_at DESC LIMIT 1`, [ids.agentId]);
    expect((hist.rows[0] as { to_status: string }).to_status).toBe("OFFLINE");
  });

  it("API-007: agent avec ticket CALLED déconnecté au-delà de la grâce → ticket WAITING PRIORITY + alerte", async () => {
    await setStatus("AVAILABLE");
    const ticketId = await insertOpenTicket("CALLED");
    await markDisconnect(redis, ids.agentId);
    const outcome = await processDisconnect({ db, redis, bus, bankId: ids.bankId, agentId: ids.agentId });
    expect(outcome.requeuedTicketId).toBe(ticketId);
    const t = await db.query(`SELECT status, priority FROM tickets WHERE id = $1`, [ticketId]);
    expect(t.rows[0]).toMatchObject({ status: "WAITING", priority: "PRIORITY" });
    expect(bus.ofType("alert:manager")[0]?.payload).toMatchObject({ type: "AGENT_DISCONNECTED_WITH_TICKET" });
  });

  it("API-007: déconnexion SANS ticket au-delà de la grâce → OFFLINE simple, aucune alerte", async () => {
    await setStatus("AVAILABLE");
    await markDisconnect(redis, ids.agentId);
    const outcome = await processDisconnect({ db, redis, bus, bankId: ids.bankId, agentId: ids.agentId });
    expect(outcome.processed).toBe(true);
    expect(outcome.requeuedTicketId).toBeNull();
    expect(bus.ofType("alert:manager")).toHaveLength(0);
    expect(await getCurrentStatus(db, ids.agentId)).toBe("OFFLINE");
  });

  it("API-007: reconnexion (DEL clé) avant traitement → processDisconnect NE traite PAS l'agent sans ticket", async () => {
    await setStatus("AVAILABLE");
    await markDisconnect(redis, ids.agentId);
    // Reconnexion : la clé est effacée → le traitement planifié doit être inerte.
    await cancelDisconnect(redis, ids.agentId);
    const outcome = await processDisconnect({ db, redis, bus, bankId: ids.bankId, agentId: ids.agentId });
    expect(outcome.processed).toBe(false);
    expect(await getCurrentStatus(db, ids.agentId)).toBe("AVAILABLE");
  });
});
