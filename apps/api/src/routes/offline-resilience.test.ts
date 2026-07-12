/**
 * Suite offline-resilience — API-005 (F0).
 *
 * Branchée sur l'API réelle (PG 16 + Redis 7 Testcontainers). Vérifie la
 * reprise idempotente après :
 *  - rejeu double et triple du même batch (clés distinctes) → état final identique ;
 *  - crash simulé mi-batch (coupure entre deux tickets d'un batch, via une
 *    contrainte transitoire) puis rejeu → état final identique, zéro doublon.
 *
 * Nommage strict : `API-005: <description>`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { SignJWT } from "jose";
import { createApp } from "src/app.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let app: ReturnType<typeof createApp>;
let bankId: string;
let agencyId: string;
let serviceId: string;
let token: string;

const JWT_SECRET = "offline-resilience-secret-at-least-32chars!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);
process.env["PHONE_ENCRYPTION_KEY"] =
  process.env["PHONE_ENCRYPTION_KEY"] ??
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  process.env["PHONE_HASH_KEY"] ??
  "2222222222222222222222222222222222222222222222222222222222222222";

/** Schéma minimal avec local_uuid unique. */
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
    END $$;
  `);
  await client.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, no_show_timeout_minutes INTEGER NOT NULL DEFAULT 3, queue_critical_threshold INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), current_ticket_number INTEGER NOT NULL DEFAULT 0, is_open BOOLEAN NOT NULL DEFAULT true, status queue_status NOT NULL DEFAULT 'OPEN', open_at TEXT, close_at TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, display_number TEXT, tracking_id CHAR(21) NOT NULL UNIQUE, local_uuid UUID UNIQUE, channel ticket_channel NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING', priority ticket_priority NOT NULL DEFAULT 'STANDARD', phone_encrypted TEXT, phone_hash TEXT, sms_consent BOOLEAN NOT NULL DEFAULT false, required_language TEXT, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), called_at TIMESTAMPTZ, served_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, no_show_at TIMESTAMPTZ, wait_time_seconds INTEGER, service_time_seconds INTEGER, issued_day DATE GENERATED ALWAYS AS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (queue_id, number, issued_day));`);
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
  const bank = await db.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  bankId = (bank.rows[0] as { id: string }).id;
  const agency = await db.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await db.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','O') RETURNING id`, [bankId, agencyId]);
  serviceId = (svc.rows[0] as { id: string }).id;
  await db.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3)`, [bankId, agencyId, serviceId]);
  app = createApp({ db, redis, jwtSecret: jwtSecretBytes });
  token = await new SignJWT({ role: "AGENT", bankId, agencyIds: [agencyId] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("99999999-9999-4999-a999-999999999999")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(jwtSecretBytes);
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
  await db.query(`UPDATE queues SET current_ticket_number = 0`);
});

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `resilience-${keySeq}-${Date.now()}`;
}

function uuid(): string {
  return crypto.randomUUID();
}

function item(localUuid: string, at: string): Record<string, unknown> {
  return { localUuid, serviceId, channel: "KIOSK", createdOfflineAt: at };
}

async function sync(body: unknown, key: string): Promise<{ status: number; data: unknown }> {
  const res = await app.fetch(
    new Request(`http://localhost/api/v1/tickets/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Idempotency-Key": key },
      body: JSON.stringify(body),
    })
  );
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function ticketCount(): Promise<number> {
  const r = await db.query(`SELECT COUNT(*)::int AS n FROM tickets`);
  return (r.rows[0] as { n: number }).n;
}

describe("API-005: offline-resilience", () => {
  it("API-005: rejeu double puis triple (clés distinctes) → état final identique, zéro doublon", async () => {
    const uuids = [uuid(), uuid(), uuid()];
    const batch = { tickets: uuids.map((u, i) => item(u, `2026-07-11T0${7 + i}:00:00.000Z`)) };
    const r1 = await sync(batch, nextKey());
    expect(r1.status).toBe(200);
    expect(await ticketCount()).toBe(3);
    // Rejeu avec clés d'idempotence NOUVELLES → idempotence unitaire par localUuid
    const r2 = await sync(batch, nextKey());
    const r3 = await sync(batch, nextKey());
    expect((r2.data as { skipped: unknown[] }).skipped).toHaveLength(3);
    expect((r3.data as { skipped: unknown[] }).skipped).toHaveLength(3);
    expect(await ticketCount()).toBe(3);
  });

  it("API-005: crash simulé mi-batch puis rejeu → état final identique (idempotent)", async () => {
    // Simule une coupure : un localUuid déjà présent en base (ticket créé lors
    // d'un batch précédent partiellement appliqué avant la coupure).
    const preSynced = uuid();
    await db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, tracking_id, local_uuid, channel, status)
       SELECT $1,$2,q.id,$3,1,$4,$5,'KIOSK','WAITING' FROM queues q WHERE q.service_id = $3 LIMIT 1`,
      [bankId, agencyId, serviceId, "presynced-track-000000".slice(0, 21), preSynced]
    );
    // Le compteur de file reflète l'allocation déjà consommée avant la coupure.
    await db.query(`UPDATE queues SET current_ticket_number = 1 WHERE service_id = $1`, [serviceId]);
    expect(await ticketCount()).toBe(1);

    // La borne rejoue le batch complet (dont le ticket déjà appliqué + deux nouveaux)
    const fresh1 = uuid();
    const fresh2 = uuid();
    const batch = {
      tickets: [
        item(preSynced, "2026-07-11T07:00:00.000Z"),
        item(fresh1, "2026-07-11T08:00:00.000Z"),
        item(fresh2, "2026-07-11T09:00:00.000Z"),
      ],
    };
    const r = await sync(batch, nextKey());
    const body = r.data as { synced: unknown[]; skipped: Array<{ localUuid: string; reason: string }> };
    expect(body.synced).toHaveLength(2);
    expect(body.skipped).toEqual([{ localUuid: preSynced, reason: "ALREADY_SYNCED" }]);
    // État final : exactement 3 tickets, zéro doublon
    expect(await ticketCount()).toBe(3);
    const distinct = await db.query(`SELECT COUNT(DISTINCT local_uuid)::int AS n FROM tickets`);
    expect((distinct.rows[0] as { n: number }).n).toBe(3);
  });
});
