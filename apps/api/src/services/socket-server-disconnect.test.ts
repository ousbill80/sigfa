/**
 * Tests d'intégration — API-007 : wiring anti-flap dans le serveur Socket.io
 * (Testcontainers PG16 + Redis 7 réels, vrai client socket).
 *
 * Vérifie le branchement de bout en bout : déconnexion socket → marque anti-flap
 * `SET NX` par agentId ; passé la grâce (courte en test), l'agent avec ticket
 * SERVING déclenche AGENT_DISCONNECTED_WITH_TICKET + WAITING PRIORITY.
 *
 * Nommage strict : `API-007: <description>`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { SignJWT } from "jose";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { AddressInfo } from "net";
import { serve } from "@hono/node-server";
import type http from "http";
import { createApp } from "src/app.js";
import { createSocketServer } from "src/services/socket-server.js";
import { createCaptureBus, type CaptureBus } from "src/services/realtime.js";
import { graceKey } from "src/services/agent-disconnect.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let bus: CaptureBus;
let httpServer: http.Server;
let serverUrl: string;
let ids: { bankId: string; agencyId: string; agentId: string; serviceId: string; queueId: string; counterId: string };

const JWT_SECRET = "socket-disconnect-test-secret-32-chars-long!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);

async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='agent_status') THEN CREATE TYPE agent_status AS ENUM ('AVAILABLE','SERVING','PAUSED','ABSENT','OFFLINE'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_status') THEN CREATE TYPE ticket_status AS ENUM ('WAITING','CALLED','SERVING','DONE','NO_SHOW','ABANDONED','TRANSFERRED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_priority') THEN CREATE TYPE ticket_priority AS ENUM ('STANDARD','PRIORITY','VIP','PMR','SENIOR'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='queue_status') THEN CREATE TYPE queue_status AS ENUM ('OPEN','PAUSED','CLOSED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='counter_status') THEN CREATE TYPE counter_status AS ENUM ('OPEN','PAUSED','CLOSED'); END IF;
    END $$;
  `);
  await client.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS operations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), code VARCHAR(6) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER, display_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, icon_key TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(service_id, code));`);
  await client.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), status queue_status NOT NULL DEFAULT 'OPEN', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID REFERENCES banks(id), email TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'AGENT', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agency_users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), user_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(agency_id, user_id));`);
  await client.query(`CREATE TABLE IF NOT EXISTS counters (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL, status counter_status NOT NULL DEFAULT 'OPEN', agent_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), operation_id UUID REFERENCES operations(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING', priority ticket_priority NOT NULL DEFAULT 'STANDARD', called_at TIMESTAMPTZ, served_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
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
  // agent id doit être un UUID (sub JWT).
  const u = await client.query(`INSERT INTO users (bank_id, email, role) VALUES ($1,'agent@b.ci','AGENT') RETURNING id`, [bankId]);
  const agentId = (u.rows[0] as { id: string }).id;
  await client.query(`INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`, [bankId, agencyId, agentId]);
  const ctr = await client.query(`INSERT INTO counters (bank_id, agency_id, number, label, agent_id) VALUES ($1,$2,1,'G1',$3) RETURNING id`, [bankId, agencyId, agentId]);
  const counterId = (ctr.rows[0] as { id: string }).id;
  return { bankId, agencyId, agentId, serviceId, queueId, counterId };
}

async function agentToken(): Promise<string> {
  return new SignJWT({ role: "AGENT", bankId: ids.bankId, agencyIds: [ids.agencyId] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ids.agentId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(jwtSecretBytes);
}

async function connectClient(token: string): Promise<ClientSocket> {
  const socket = ioClient(serverUrl, { transports: ["websocket"], auth: { token }, reconnection: false });
  return new Promise<ClientSocket>((resolve, reject) => {
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
    setTimeout(() => reject(new Error("connect timeout")), 10_000);
  });
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor timeout");
}

beforeAll(async () => {
  // Grâce très courte pour rendre le test rapide (config injectable — critère 8).
  process.env["AGENT_DISCONNECT_GRACE_S"] = "1";
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

  const app = createApp({ db, redis, jwtSecret: jwtSecretBytes, bus });
  httpServer = serve({ fetch: app.fetch, port: 0 }) as unknown as http.Server;
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  const addr = httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${addr.port}`;
  createSocketServer(httpServer, { db, redis, jwtSecret: jwtSecretBytes, bus });
}, 180_000);

afterAll(async () => {
  delete process.env["AGENT_DISCONNECT_GRACE_S"];
  await redis.quit();
  await db.end();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await pgContainer.stop();
  await redisContainer.stop();
}, 60_000);

beforeEach(async () => {
  bus.events.length = 0;
  await redis.flushall();
  await db.query(`DELETE FROM tickets`);
  await db.query(`DELETE FROM agent_status_history`);
});

describe("API-007: anti-flap agentId — Redis SET NX TTL ; reconnexion → DEL ; >grâce → WAITING PRIORITY + alerte (wiring socket réel)", () => {
  it("API-007: déconnexion socket → clé anti-flap posée pour l'agentId", async () => {
    const socket = await connectClient(await agentToken());
    socket.disconnect();
    await waitFor(async () => (await redis.exists(graceKey(ids.agentId))) === 1, 3000);
    expect(await redis.exists(graceKey(ids.agentId))).toBe(1);
  }, 20_000);

  it("API-007: reconnexion dans la fenêtre → clé anti-flap effacée (aucun traitement)", async () => {
    const s1 = await connectClient(await agentToken());
    s1.disconnect();
    await waitFor(async () => (await redis.exists(graceKey(ids.agentId))) === 1, 3000);
    // Reconnexion → cancelDisconnect efface la clé.
    const s2 = await connectClient(await agentToken());
    await waitFor(async () => (await redis.exists(graceKey(ids.agentId))) === 0, 3000);
    expect(await redis.exists(graceKey(ids.agentId))).toBe(0);
    s2.disconnect();
  }, 20_000);

  it("API-007: agent avec ticket SERVING déconnecté > grâce → ticket WAITING PRIORITY + AGENT_DISCONNECTED_WITH_TICKET", async () => {
    await db.query(`INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status) VALUES ($1,$2,$3,'SERVING')`, [ids.bankId, ids.agencyId, ids.agentId]);
    const t = await db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, counter_id, agent_id, number, status, priority, called_at, served_at)
       VALUES ($1,$2,$3,$4,$5,$6,1,'SERVING','STANDARD',NOW(),NOW()) RETURNING id`,
      [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, ids.counterId, ids.agentId]
    );
    const ticketId = (t.rows[0] as { id: string }).id;

    const socket = await connectClient(await agentToken());
    socket.disconnect();

    // Passé la grâce (~1 s), le traitement doit s'exécuter.
    await waitFor(async () => bus.ofType("alert:manager").some((e) => (e.payload as { type: string }).type === "AGENT_DISCONNECTED_WITH_TICKET"), 6000);

    const row = await db.query(`SELECT status, priority FROM tickets WHERE id = $1`, [ticketId]);
    expect(row.rows[0]).toMatchObject({ status: "WAITING", priority: "PRIORITY" });
  }, 20_000);
});
