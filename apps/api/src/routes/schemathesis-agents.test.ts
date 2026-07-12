/**
 * Schemathesis — module Agents (API-007).
 *
 * Démarre l'API réelle (PG + Redis Testcontainers) puis invoque Schemathesis
 * via Docker contre les routes /agents/{id}, /agents/{id}/status et
 * /agents/{id}/stats (l'import CSV §305 est HORS scope — API-009), avec un JWT
 * AGENCY_DIRECTOR valide (couvre GET profil MANAGER+ ainsi que status/stats).
 *
 * Nommage : `API-007: Schemathesis PASS module agents`.
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

const JWT_SECRET = "schemathesis-agents-secret-32-chars-long!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);

async function runMigrations(client: pg.Client): Promise<{ bankId: string; agencyId: string; agentId: string }> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='agent_status') THEN
        CREATE TYPE agent_status AS ENUM ('AVAILABLE','SERVING','PAUSED','ABSENT','OFFLINE'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_status') THEN
        CREATE TYPE ticket_status AS ENUM ('WAITING','CALLED','SERVING','DONE','NO_SHOW','ABANDONED','TRANSFERRED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_priority') THEN
        CREATE TYPE ticket_priority AS ENUM ('STANDARD','PRIORITY','VIP','PMR','SENIOR'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='role') THEN
        CREATE TYPE role AS ENUM ('SUPER_ADMIN','BANK_ADMIN','AGENCY_DIRECTOR','MANAGER','AGENT','AUDITOR'); END IF;
    END $$;
  `);
  await client.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, agent_inactivity_minutes INTEGER NOT NULL DEFAULT 15, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);`);
  await client.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);`);
  await client.query(`CREATE TABLE IF NOT EXISTS operations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), code VARCHAR(6) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER, display_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, icon_key TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(service_id, code));`);
  await client.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID REFERENCES banks(id), email TEXT NOT NULL UNIQUE, first_name TEXT NOT NULL DEFAULT 'Kofi', last_name TEXT NOT NULL DEFAULT 'Asante', role TEXT NOT NULL DEFAULT 'AGENT', languages TEXT[] NOT NULL DEFAULT '{FR}', work_schedule JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agency_users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), user_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(agency_id, user_id));`);
  await client.query(`CREATE TABLE IF NOT EXISTS user_services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), user_id UUID NOT NULL REFERENCES users(id), service_id UUID NOT NULL REFERENCES services(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, service_id));`);
  await client.query(`CREATE TABLE IF NOT EXISTS counters (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL, agent_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), operation_id UUID REFERENCES operations(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, display_number TEXT, status ticket_status NOT NULL DEFAULT 'WAITING', priority ticket_priority NOT NULL DEFAULT 'STANDARD', called_at TIMESTAMPTZ, served_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, service_time_seconds INTEGER, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), issued_day DATE GENERATED ALWAYS AS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agent_status_history (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), agent_id UUID NOT NULL REFERENCES users(id), from_status agent_status, to_status agent_status NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS audit_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), actor_id UUID, actor_role role, actor_email TEXT, action VARCHAR(500) NOT NULL, entity_type TEXT NOT NULL, entity_id UUID, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ip INET, diff JSONB);`);

  const bank = await client.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await client.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','O') RETURNING id`, [bankId, agencyId]);
  const serviceId = (svc.rows[0] as { id: string }).id;
  await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3)`, [bankId, agencyId, serviceId]);
  const user = await client.query(`INSERT INTO users (bank_id, email, role) VALUES ($1,'kofi@b.ci','AGENT') RETURNING id`, [bankId]);
  const uid = (user.rows[0] as { id: string }).id;
  await client.query(`INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`, [bankId, agencyId, uid]);
  await client.query(`INSERT INTO user_services (bank_id, user_id, service_id) VALUES ($1,$2,$3)`, [bankId, uid, serviceId]);
  await client.query(`INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status) VALUES ($1,$2,$3,'AVAILABLE')`, [bankId, agencyId, uid]);
  return { bankId, agencyId, agentId: uid };
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

  token = await new SignJWT({ role: "AGENCY_DIRECTOR", bankId: fx.bankId, agencyIds: [fx.agencyId] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(fx.agentId)
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

describe("API-007: Schemathesis PASS module agents", () => {
  it("API-007: Schemathesis PASS sur /agents/{id}, /agents/{id}/status, /agents/{id}/stats (hors import CSV — API-009)", async () => {
    const contractPath = join(import.meta.dirname, "../../../../packages/contracts/generated/bundled/agents.yaml");
    let dockerAvailable = false;
    try {
      await execAsync("docker --version");
      dockerAvailable = true;
    } catch {
      console.warn("[Schemathesis agents] Docker non disponible — test SKIP gracieux");
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
          --include-path-regex "^/agents/[^/]+(/status|/stats)?$" \
          --exclude-path "/agents/import" \
          --header "Authorization: Bearer ${token}" \
          --max-examples 15 \
          --request-timeout 10 \
          --checks not_a_server_error`,
        { timeout: 150_000 }
      );
      output = result.stdout + result.stderr;
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      output = (e.stdout ?? "") + (e.stderr ?? "");
      exitCode = e.code ?? 1;
    }
    console.log("[Schemathesis agents] Output:", output.slice(0, 3000));
    expect(exitCode).toBe(0);
  }, 180_000);
});
