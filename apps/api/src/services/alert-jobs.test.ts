/**
 * Tests d'intégration — API-007 : scans d'alertes manager + verrou distribué
 * (Testcontainers PG16 + Redis 7 réels).
 *
 * Couvre critères 6, 7 (et le cœur du 8 via le verrou) :
 *  - AGENT_INACTIVE : inactif > seuil → UNE alerte ; reset d'épisode ;
 *  - SLA_BREACH : dépassement → alerte ; >2× SLA → escalated ;
 *  - verrou distribué : 2 instances concurrentes → UNE seule alerte émise.
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
  scanInactiveAgents,
  scanSlaBreaches,
  runLockedScan,
  INACTIVE_SCAN_LOCK,
} from "src/services/alert-jobs.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let bus: CaptureBus;
let ids: { bankId: string; agencyId: string; agentId: string; serviceId: string; queueId: string };

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
  await client.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, agent_inactivity_minutes INTEGER NOT NULL DEFAULT 15, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID REFERENCES banks(id), email TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'AGENT', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING', priority ticket_priority NOT NULL DEFAULT 'STANDARD', called_at TIMESTAMPTZ, served_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agent_status_history (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), agent_id UUID NOT NULL REFERENCES users(id), from_status agent_status, to_status agent_status NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
}

async function insertFixtures(client: pg.Client): Promise<typeof ids> {
  const bank = await client.query(`INSERT INTO banks (name, slug, agent_inactivity_minutes) VALUES ('B','b',15) RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await client.query(`INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'OC','O',10) RETURNING id`, [bankId, agencyId]);
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`, [bankId, agencyId, serviceId]);
  const queueId = (q.rows[0] as { id: string }).id;
  const user = await client.query(`INSERT INTO users (bank_id, email) VALUES ($1,'agent@b.ci') RETURNING id`, [bankId]);
  const agentId = (user.rows[0] as { id: string }).id;
  return { bankId, agencyId, agentId, serviceId, queueId };
}

/** Rend l'agent AVAILABLE avec `changed_at` reculé de `minutesAgo`. */
async function setAvailableSince(minutesAgo: number): Promise<void> {
  await db.query(
    `INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status, changed_at)
     VALUES ($1,$2,$3,'AVAILABLE', NOW() - ($4 || ' minutes')::interval)`,
    [ids.bankId, ids.agencyId, ids.agentId, String(minutesAgo)]
  );
}

/** Insère un ticket SERVING servi depuis `secondsAgo`. */
async function insertServing(secondsAgo: number): Promise<string> {
  const r = await db.query(
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, agent_id, number, status, called_at, served_at)
     VALUES ($1,$2,$3,$4,$5,1,'SERVING', NOW() - ($6 || ' seconds')::interval, NOW() - ($6 || ' seconds')::interval)
     RETURNING id`,
    [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, ids.agentId, String(secondsAgo)]
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
});

describe("API-007: inactif > seuil → UNE alerte ; activité → reset d'épisode (fake timers)", () => {
  it("API-007: agent AVAILABLE depuis > seuil → 1 alerte AGENT_INACTIVE ; 2ᵉ passe → 0 (une par épisode)", async () => {
    await setAvailableSince(20); // seuil banque = 15 min
    const first = await scanInactiveAgents(db, redis, bus);
    expect(first).toBe(1);
    const alert = bus.ofType("alert:manager")[0]?.payload as { type: string; payload: Record<string, unknown> };
    expect(alert.type).toBe("AGENT_INACTIVE");
    expect(alert.payload["agentId"]).toBe(ids.agentId);

    bus.events.length = 0;
    const second = await scanInactiveAgents(db, redis, bus);
    expect(second).toBe(0);
    expect(bus.ofType("alert:manager")).toHaveLength(0);
  });

  it("API-007: sous le seuil → aucune alerte", async () => {
    await setAvailableSince(5);
    expect(await scanInactiveAgents(db, redis, bus)).toBe(0);
  });

  it("API-007: reprise d'activité (statut change) → reset ; nouvel épisode ré-alerte", async () => {
    await setAvailableSince(20);
    expect(await scanInactiveAgents(db, redis, bus)).toBe(1);

    // Reprise : l'agent sort d'AVAILABLE → n'est plus candidat → flag reset.
    await db.query(
      `INSERT INTO agent_status_history (bank_id, agency_id, agent_id, from_status, to_status) VALUES ($1,$2,$3,'AVAILABLE','SERVING')`,
      [ids.bankId, ids.agencyId, ids.agentId]
    );
    await scanInactiveAgents(db, redis, bus);
    expect(await redis.get(`agent_inactive_alerted:${ids.agentId}`)).toBeNull();

    // Nouvel épisode d'inactivité → ré-alerte.
    await db.query(`DELETE FROM agent_status_history`);
    await setAvailableSince(20);
    bus.events.length = 0;
    expect(await scanInactiveAgents(db, redis, bus)).toBe(1);
  });

  it("API-007: appel de ticket après passage AVAILABLE → agent actif → pas d'alerte", async () => {
    await setAvailableSince(20);
    await db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, agent_id, number, status, called_at) VALUES ($1,$2,$3,$4,$5,7,'CALLED', NOW())`,
      [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, ids.agentId]
    );
    expect(await scanInactiveAgents(db, redis, bus)).toBe(0);
  });
});

describe("API-007: SLA dépassé → alerte ; >2× → escalated (fake timers)", () => {
  it("API-007: ticket SERVING > SLA (10 min) → 1 alerte SLA_BREACH non escalée", async () => {
    await insertServing(11 * 60); // > 600s SLA, < 1200s
    const n = await scanSlaBreaches(db, redis, bus);
    expect(n).toBe(1);
    const alert = bus.ofType("alert:manager")[0]?.payload as { type: string; payload: { escalated: boolean } };
    expect(alert.type).toBe("SLA_BREACH");
    expect(alert.payload.escalated).toBe(false);
  });

  it("API-007: ticket SERVING > 2× SLA → alerte renouvelée marquée escalated", async () => {
    await insertServing(25 * 60); // > 1200s = 2× SLA
    const n = await scanSlaBreaches(db, redis, bus);
    expect(n).toBe(1);
    const alert = bus.ofType("alert:manager")[0]?.payload as { type: string; payload: { escalated: boolean } };
    expect(alert.payload.escalated).toBe(true);
  });

  it("API-007: passe répétée sans changement de palier → pas de rafale (UNE par palier)", async () => {
    await insertServing(11 * 60);
    expect(await scanSlaBreaches(db, redis, bus)).toBe(1);
    bus.events.length = 0;
    expect(await scanSlaBreaches(db, redis, bus)).toBe(0);
  });

  it("API-007: sous le SLA → aucune alerte", async () => {
    await insertServing(2 * 60);
    expect(await scanSlaBreaches(db, redis, bus)).toBe(0);
  });
});

describe("API-007: jobs BullMQ repeatable inactive-agent-scan + sla-scan — verrou distribué concurrency=1 ; 2 instances → UNE seule alerte émise (test de course Testcontainers)", () => {
  it("API-007: 2 scans concurrents sous verrou distribué → UNE seule alerte AGENT_INACTIVE", async () => {
    await setAvailableSince(20);
    const busA = createCaptureBus();
    const busB = createCaptureBus();

    // Deux « instances » lancent le scan en parallèle sous le même verrou.
    const [a, b] = await Promise.all([
      runLockedScan(redis, INACTIVE_SCAN_LOCK, () => scanInactiveAgents(db, redis, busA)),
      runLockedScan(redis, INACTIVE_SCAN_LOCK, () => scanInactiveAgents(db, redis, busB)),
    ]);

    const total = a + b;
    const emitted = busA.ofType("alert:manager").length + busB.ofType("alert:manager").length;
    expect(total).toBe(1);
    expect(emitted).toBe(1);
  });

  it("API-007: verrou non réentrant — une passe en cours bloque la seconde", async () => {
    const acquired = await runLockedScan(redis, INACTIVE_SCAN_LOCK, async () => {
      // Pendant la passe, une seconde tentative doit être bloquée (0).
      const inner = await runLockedScan(redis, INACTIVE_SCAN_LOCK, async () => 99);
      expect(inner).toBe(0);
      return 1;
    });
    expect(acquired).toBe(1);
  });
});
