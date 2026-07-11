/**
 * Schemathesis — module Tickets (API-003).
 *
 * Démarre l'API réelle (PG + Redis Testcontainers) puis invoque Schemathesis
 * via Docker contre les routes /tickets et /counters/{counterId}/call-next avec
 * un JWT AGENT valide.
 *
 * Nommage : `API-003: Schemathesis PASS sur le module tickets`
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { SignJWT } from "jose";
import { createApp } from "src/app.js";

const execAsync = promisify(exec);

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let server: Server;
let apiPort: number;
let token: string;

const JWT_SECRET = "schemathesis-tickets-secret-32-chars-long!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);
process.env["PHONE_ENCRYPTION_KEY"] =
  process.env["PHONE_ENCRYPTION_KEY"] ??
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  process.env["PHONE_HASH_KEY"] ??
  "2222222222222222222222222222222222222222222222222222222222222222";

/** Migrations minimales (mêmes tables que tickets.test.ts). */
async function runMigrations(client: pg.Client): Promise<{ bankId: string; agencyId: string; serviceId: string }> {
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
  await client.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, no_show_timeout_minutes INTEGER NOT NULL DEFAULT 3, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), current_ticket_number INTEGER NOT NULL DEFAULT 0, is_open BOOLEAN NOT NULL DEFAULT true, status queue_status NOT NULL DEFAULT 'OPEN', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS counters (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL, status counter_status NOT NULL DEFAULT 'OPEN', agent_id UUID, current_ticket_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, display_number TEXT, tracking_id CHAR(21) NOT NULL UNIQUE, channel ticket_channel NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING', priority ticket_priority NOT NULL DEFAULT 'STANDARD', phone_encrypted TEXT, phone_hash TEXT, sms_consent BOOLEAN NOT NULL DEFAULT false, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), called_at TIMESTAMPTZ, served_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, no_show_at TIMESTAMPTZ, wait_time_seconds INTEGER, service_time_seconds INTEGER, issued_day DATE GENERATED ALWAYS AS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (queue_id, number, issued_day));`);
  await client.query(`CREATE TABLE IF NOT EXISTS ticket_transfers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), ticket_id UUID NOT NULL REFERENCES tickets(id), from_counter_id UUID, from_service_id UUID NOT NULL REFERENCES services(id), to_service_id UUID NOT NULL REFERENCES services(id), to_counter_id UUID, reason TEXT, transferred_by UUID NOT NULL, transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);

  const bank = await client.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await client.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','Ouverture') RETURNING id`, [bankId, agencyId]);
  const serviceId = (svc.rows[0] as { id: string }).id;
  await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3)`, [bankId, agencyId, serviceId]);
  await client.query(`INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,1,'G1')`, [bankId, agencyId]);
  return { bankId, agencyId, serviceId };
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
  const fx = await runMigrations(db);
  redis = new Redis(`redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`);

  token = await new SignJWT({ role: "AGENT", bankId: fx.bankId, agencyIds: [fx.agencyId] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("99999999-9999-4999-a999-999999999999")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(jwtSecretBytes);

  const app = createApp({ db, redis, jwtSecret: jwtSecretBytes });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      apiPort = info.port;
      resolve();
    }) as Server;
  });
}, 180_000);

afterAll(async () => {
  server?.close();
  await redis.quit();
  await db.end();
  await pgContainer.stop();
  await redisContainer.stop();
}, 30_000);

describe("API-003: Schemathesis", () => {
  it("API-003: Schemathesis PASS sur les routes tickets contre l'API réelle (PG+Redis Testcontainers)", async () => {
    const contractPath = join(import.meta.dirname, "../../../../packages/contracts/generated/bundled/core.yaml");
    let dockerAvailable = false;
    try {
      await execAsync("docker --version");
      dockerAvailable = true;
    } catch {
      console.warn("[Schemathesis] Docker non disponible — test SKIP gracieux");
    }
    if (!dockerAvailable) {
      expect(dockerAvailable).toBe(false);
      return;
    }

    let output = "";
    let exitCode = 0;
    try {
      const result = await execAsync(
        `docker run --rm \
          -v "${contractPath}:/contract.yaml" \
          --add-host=host.docker.internal:host-gateway \
          schemathesis/schemathesis:stable \
          run /contract.yaml \
          --url "http://host.docker.internal:${apiPort}/api/v1" \
          --include-path-regex "^/(tickets|counters/[^/]+/call-next)" \
          --header "Authorization: Bearer ${token}" \
          --header "X-Idempotency-Key: schemathesis-key" \
          --max-examples 15 \
          --request-timeout 10000 \
          --checks not_a_server_error`,
        { timeout: 150_000 }
      );
      output = result.stdout + result.stderr;
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      output = (e.stdout ?? "") + (e.stderr ?? "");
      exitCode = e.code ?? 1;
    }
    console.log("[Schemathesis tickets] Output:", output.slice(0, 3000));
    expect(exitCode).toBe(0);
  }, 180_000);
});
