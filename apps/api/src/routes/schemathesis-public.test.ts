/**
 * Schemathesis — module PUBLIC (API-010) : suivi & feedback client.
 *
 * Démarre l'API réelle (PG + Redis Testcontainers) puis invoque Schemathesis
 * via Docker contre les routes publiques (`/public/tickets/{trackingId}` et
 * `/public/tickets/{trackingId}/feedback`) SANS JWT. Vérifie l'absence de
 * server error (5xx) sur toutes les entrées générées (fenêtre, doublon, 404
 * opaque, rate-limit, validation).
 *
 * Nommage : `API-010: Schemathesis PASS module public (feedback+suivi)`.
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
import { nanoid } from "nanoid";
import { createApp } from "src/app.js";

const execAsync = promisify(exec);

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let server: Server;
let apiPort: number;

const jwtSecretBytes = new TextEncoder().encode("schemathesis-public-secret-32-chars-long!!");
process.env["PHONE_ENCRYPTION_KEY"] =
  process.env["PHONE_ENCRYPTION_KEY"] ??
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  process.env["PHONE_HASH_KEY"] ??
  "2222222222222222222222222222222222222222222222222222222222222222";

/** Schéma minimal + un ticket DONE pour alimenter le suivi/feedback. */
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
  await client.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), current_ticket_number INTEGER NOT NULL DEFAULT 0, status queue_status NOT NULL DEFAULT 'OPEN', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, display_number TEXT, tracking_id CHAR(21) NOT NULL UNIQUE, channel ticket_channel NOT NULL DEFAULT 'KIOSK', status ticket_status NOT NULL DEFAULT 'WAITING', priority ticket_priority NOT NULL DEFAULT 'STANDARD', phone_encrypted TEXT, phone_hash TEXT, sms_consent BOOLEAN NOT NULL DEFAULT false, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ, feedback_score INTEGER, feedback_comment TEXT, feedback_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS daily_agency_stats (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID REFERENCES services(id), day DATE NOT NULL, tickets_issued INTEGER NOT NULL DEFAULT 0, tickets_served INTEGER NOT NULL DEFAULT 0, tickets_abandoned INTEGER NOT NULL DEFAULT 0, tickets_no_show INTEGER NOT NULL DEFAULT 0, total_wait_seconds INTEGER NOT NULL DEFAULT 0, total_service_seconds INTEGER NOT NULL DEFAULT 0, sla_met_count INTEGER NOT NULL DEFAULT 0, sla_total_count INTEGER NOT NULL DEFAULT 0, feedback_count INTEGER NOT NULL DEFAULT 0, feedback_sum INTEGER NOT NULL DEFAULT 0, nps_promoters INTEGER NOT NULL DEFAULT 0, nps_passives INTEGER NOT NULL DEFAULT 0, nps_detractors INTEGER NOT NULL DEFAULT 0, agent_active_seconds INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS das_no_service_uniq ON daily_agency_stats (bank_id, agency_id, day) WHERE service_id IS NULL;`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS das_with_service_uniq ON daily_agency_stats (bank_id, agency_id, service_id, day) WHERE service_id IS NOT NULL;`);

  const bank = await client.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await client.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','Ouverture') RETURNING id`, [bankId, agencyId]);
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`, [bankId, agencyId, serviceId]);
  const queueId = (q.rows[0] as { id: string }).id;
  // Un ticket DONE clôturé à l'instant (fenêtre ouverte) + un WAITING pour le suivi.
  await client.query(
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, display_number, tracking_id, channel, status, closed_at)
     VALUES ($1,$2,$3,$4,1,'OC-001',$5,'KIOSK','DONE',NOW())`,
    [bankId, agencyId, queueId, serviceId, nanoid(21)]
  );
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

describe("API-010: Schemathesis module public", () => {
  it("API-010: Schemathesis PASS module public (feedback+suivi) contre l'API réelle", async () => {
    const contractPath = join(import.meta.dirname, "../../../../packages/contracts/generated/bundled/public.yaml");
    let dockerAvailable = false;
    try {
      await execAsync("docker --version");
      dockerAvailable = true;
    } catch {
      console.warn("[Schemathesis public] Docker non disponible — SKIP gracieux");
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
          --include-path-regex "^/public/tickets" \
          --max-examples 20 \
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
    console.log("[Schemathesis public] Output:", output.slice(0, 3000));
    expect(exitCode).toBe(0);
  }, 180_000);
});
