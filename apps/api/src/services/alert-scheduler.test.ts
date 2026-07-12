/**
 * Tests d'intégration — API-007 : planificateur BullMQ des scans d'alertes
 * (Testcontainers PG16 + Redis 7 réels).
 *
 * Vérifie que les jobs repeatable `inactive-agent-scan` et `sla-scan` sont
 * enregistrés avec l'intervalle de `config/alerting.ts` (injectable via env), et
 * que le worker (concurrency=1) exécute réellement un scan qui émet une alerte.
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
  startAlertScheduler,
  type AlertScheduler,
  INACTIVE_SCAN_JOB,
  SLA_SCAN_JOB,
} from "src/services/alert-scheduler.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let bus: CaptureBus;
let connection: { host: string; port: number };
let scheduler: AlertScheduler | null = null;
let ids: { bankId: string; agencyId: string; agentId: string };

async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='agent_status') THEN CREATE TYPE agent_status AS ENUM ('AVAILABLE','SERVING','PAUSED','ABSENT','OFFLINE'); END IF; END $$;`);
  await client.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, agent_inactivity_minutes INTEGER NOT NULL DEFAULT 15, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID REFERENCES banks(id), email TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), operation_id UUID, agent_id UUID, called_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'WAITING');`);
  await client.query(`CREATE TABLE IF NOT EXISTS agent_status_history (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), agent_id UUID NOT NULL REFERENCES users(id), from_status agent_status, to_status agent_status NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
}

async function insertFixtures(client: pg.Client): Promise<typeof ids> {
  const bank = await client.query(`INSERT INTO banks (name, slug, agent_inactivity_minutes) VALUES ('B','b',15) RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const user = await client.query(`INSERT INTO users (bank_id, email) VALUES ($1,'a@b.ci') RETURNING id`, [bankId]);
  const agentId = (user.rows[0] as { id: string }).id;
  return { bankId, agencyId, agentId };
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
  connection = { host: redisContainer.getHost(), port: redisContainer.getMappedPort(6379) };
  redis = new Redis({ ...connection, maxRetriesPerRequest: null });
  await runMigrations(db);
  ids = await insertFixtures(db);
  bus = createCaptureBus();
}, 180_000);

afterAll(async () => {
  await scheduler?.close();
  await redis.quit();
  await db.end();
  await pgContainer.stop();
  await redisContainer.stop();
}, 40_000);

beforeEach(async () => {
  bus.events.length = 0;
  await redis.flushall();
  await db.query(`DELETE FROM agent_status_history`);
  process.env["AGENT_INACTIVE_SCAN_INTERVAL_S"] = "1";
  process.env["SLA_SCAN_INTERVAL_S"] = "1";
});

describe("API-007: jobs BullMQ repeatable inactive-agent-scan + sla-scan enregistrés + exécutés (worker concurrency=1)", () => {
  it("API-007: startAlertScheduler enregistre les 2 jobs repeatable et exécute un scan émettant AGENT_INACTIVE", async () => {
    // Agent AVAILABLE depuis > seuil → candidat inactif.
    await db.query(
      `INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status, changed_at) VALUES ($1,$2,$3,'AVAILABLE', NOW() - INTERVAL '20 minutes')`,
      [ids.bankId, ids.agencyId, ids.agentId]
    );

    scheduler = await startAlertScheduler({ connection, redis, db, bus });

    // Les 2 jobs repeatable existent.
    const repeatables = await scheduler.queue.getRepeatableJobs();
    const names = repeatables.map((r) => r.name).sort();
    expect(names).toContain(INACTIVE_SCAN_JOB);
    expect(names).toContain(SLA_SCAN_JOB);

    // Le worker (concurrency=1) doit finir par exécuter le scan et émettre l'alerte.
    await waitFor(async () => bus.ofType("alert:manager").some((e) => (e.payload as { type: string }).type === "AGENT_INACTIVE"), 15000);
    const alert = bus.ofType("alert:manager").find((e) => (e.payload as { type: string }).type === "AGENT_INACTIVE");
    expect(alert).toBeDefined();

    expect(scheduler.worker.concurrency).toBe(1);
  }, 40_000);
});

/** Attend qu'une condition asynchrone devienne vraie, ou échoue au timeout. */
async function waitFor(cond: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("waitFor: condition non satisfaite avant le timeout");
}
