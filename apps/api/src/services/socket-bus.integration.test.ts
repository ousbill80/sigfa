/**
 * Tests d'intégration — RT-001a (AC6) : route → CLIENT socket réel.
 *
 * Chaîne COMPLÈTE et RÉELLE (Testcontainers PG16 + Redis 7) :
 *   POST /tickets/:id/call → route F3 → `bus.emit("ticket:called", agencyId, …)`
 *   → `createSocketBus(io)` (adaptateur contrat) → diffusion `agency:{id}` →
 *   REÇU par un client `socket.io-client` réel abonné à la room.
 *
 * Ce n'est PAS un CaptureBus : la parité forme-contrat est vérifiée de bout en
 * bout, y compris contre le `payloadSchema` du CONTRAT importé.
 *
 * Nommage strict : `RT-001a: <description>`.
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
import type http from "http";
import { serve } from "@hono/node-server";
import type { Server as SocketServer } from "socket.io";
import { createApp } from "src/app.js";
import { ensureAuditLogSchema } from "src/audit/audit-log-test-schema.js";
import { createSocketServer } from "src/services/socket-server.js";
import { createSocketBus } from "src/services/socket-bus.js";
import { ticketCalledEvent } from "@sigfa/contracts/events/realtime.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let app: ReturnType<typeof createApp>;
let io: SocketServer;
let httpServer: http.Server;
let serverUrl: string;
let ids: Awaited<ReturnType<typeof insertFixtures>>;
let agentToken: string;

const JWT_SECRET = "socket-bus-integration-jwt-secret-at-least-32!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);

process.env["PHONE_ENCRYPTION_KEY"] =
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  "2222222222222222222222222222222222222222222222222222222222222222";

/** Migrations minimales (identiques aux suites F3 socket). */
async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_status') THEN
        CREATE TYPE ticket_status AS ENUM ('WAITING','CALLED','SERVING','DONE','NO_SHOW','ABANDONED','TRANSFERRED');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_priority') THEN
        CREATE TYPE ticket_priority AS ENUM ('STANDARD','PRIORITY','VIP','PMR','SENIOR');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_channel') THEN
        CREATE TYPE ticket_channel AS ENUM ('KIOSK','QR','MOBILE','WHATSAPP');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='queue_status') THEN
        CREATE TYPE queue_status AS ENUM ('OPEN','PAUSED','CLOSED');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='counter_status') THEN
        CREATE TYPE counter_status AS ENUM ('OPEN','PAUSED','CLOSED');
      END IF;
    END $$;
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS banks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      no_show_timeout_minutes INTEGER NOT NULL DEFAULT 3, queue_critical_threshold INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS agencies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL,
      sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS operations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id),
      code VARCHAR(6) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER,
      display_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, icon_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(service_id, code));`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS queues (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id),
      current_ticket_number INTEGER NOT NULL DEFAULT 0, is_open BOOLEAN NOT NULL DEFAULT true,
      status queue_status NOT NULL DEFAULT 'OPEN', open_at TEXT, close_at TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS counters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL,
      status counter_status NOT NULL DEFAULT 'OPEN', agent_id UUID, current_ticket_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id),
      service_id UUID NOT NULL REFERENCES services(id), operation_id UUID REFERENCES operations(id), counter_id UUID, agent_id UUID,
      number INTEGER NOT NULL, display_number TEXT, tracking_id CHAR(21) NOT NULL UNIQUE,
      channel ticket_channel NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING',
      priority ticket_priority NOT NULL DEFAULT 'STANDARD', phone_encrypted TEXT, phone_hash TEXT,
      sms_consent BOOLEAN NOT NULL DEFAULT false, required_language TEXT,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), called_at TIMESTAMPTZ, served_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ, no_show_at TIMESTAMPTZ, wait_time_seconds INTEGER, service_time_seconds INTEGER,
      issued_day DATE GENERATED ALWAYS AS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (queue_id, number, issued_day), target_manager_id UUID
);`);
  // Table borne minimale (assertKioskSessionActive au handshake WS borne).
  await client.query(`
    CREATE TABLE IF NOT EXISTS kiosks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), current_session_id UUID, session_revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
}

async function insertFixtures(client: pg.Client): Promise<{
  bankId: string; agencyId: string; serviceId: string; queueId: string; counterId: string;
}> {
  const bank = await client.query(
    `INSERT INTO banks (name, slug) VALUES ('TestBank','testbank-bus') RETURNING id`
  );
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'Agency1') RETURNING id`, [bankId]
  );
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await client.query(
    `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'OC','Ouverture',10) RETURNING id`,
    [bankId, agencyId]
  );
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await client.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
    [bankId, agencyId, serviceId]
  );
  const queueId = (q.rows[0] as { id: string }).id;
  const ctr = await client.query(
    `INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,1,'Guichet 1') RETURNING id`,
    [bankId, agencyId]
  );
  const counterId = (ctr.rows[0] as { id: string }).id;
  return { bankId, agencyId, serviceId, queueId, counterId };
}

/** Forge un JWT AGENT pour l'agencyId. */
async function forgeToken(agencyIds: string[]): Promise<string> {
  return new SignJWT({ role: "AGENT", bankId: ids.bankId, agencyIds })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(jwtSecretBytes);
}

/** Insère un ticket WAITING et retourne son id. */
async function insertWaitingTicket(): Promise<string> {
  const res = await db.query(
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, display_number, tracking_id, channel, status)
     VALUES ($1,$2,$3,$4,
       (SELECT COALESCE(MAX(number),0)+1 FROM tickets WHERE queue_id=$3),
       'OC-001', $5, 'KIOSK', 'WAITING')
     RETURNING id`,
    [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, `tk${Math.random().toString(36).slice(2).padEnd(19, "0").slice(0, 19)}`]
  );
  return (res.rows[0] as { id: string }).id;
}

/** Connecte un client socket réel + join la room agency. */
function connectAndJoin(token: string, agencyId: string): Promise<ClientSocket> {
  const socket: ClientSocket = ioClient(serverUrl, {
    transports: ["websocket"],
    auth: { token },
    reconnection: false,
  });
  return new Promise<ClientSocket>((resolve, reject) => {
    socket.on("connect", () => {
      socket.emit("join:agency", { agencyId });
      socket.on("join:ok", () => resolve(socket));
    });
    socket.on("connect_error", reject);
    setTimeout(() => reject(new Error("connect/join timeout")), 10_000);
  });
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
  redis = new Redis(`redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`, {
    maxRetriesPerRequest: null,
  });

  await runMigrations(db);
  await ensureAuditLogSchema(db);
  ids = await insertFixtures(db);
  agentToken = await forgeToken([ids.agencyId]);

  // Câblage RT-001a mode `real` : serve() → createSocketServer → createSocketBus
  // → createApp({ bus }). C'est le socket bus RÉEL qui diffuse (pas un CaptureBus).
  httpServer = serve({ fetch: () => new Response("ok"), port: 0 }) as unknown as http.Server;
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  const addr = httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${addr.port}`;

  io = createSocketServer(httpServer, { db, redis, jwtSecret: jwtSecretBytes });
  const bus = createSocketBus(io);
  app = createApp({ db, redis, jwtSecret: jwtSecretBytes, bus });
  // Le client socket réel se connecte au httpServer (io attaché). La route HTTP
  // est exercée in-process via `app.request` : elle exécute le VRAI handler avec
  // le VRAI socket bus → l'émission part par `io` vers le client réel connecté.
}, 180_000);

afterAll(async () => {
  io.close();
  await redis.quit();
  await db.end();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await pgContainer.stop();
  await redisContainer.stop();
}, 60_000);

beforeEach(async () => {
  await redis.flushall();
  await db.query(`DELETE FROM tickets`);
  await db.query(`UPDATE queues SET current_ticket_number = 0`);
});

describe("RT-001a: route → client socket réel (AC6)", () => {
  it(
    "RT-001a: POST /tickets/:id/call → ticket:called (forme CONTRAT) reçu par un client socket.io-client réel abonné à agency:{id}",
    async () => {
      const ticketId = await insertWaitingTicket();
      const client = await connectAndJoin(agentToken, ids.agencyId);

      const received = new Promise<Record<string, unknown>>((resolve, reject) => {
        client.on("ticket:called", (payload: Record<string, unknown>) => resolve(payload));
        setTimeout(() => reject(new Error("ticket:called non reçu")), 8_000);
      });

      const res = await app.request(`/api/v1/tickets/${ticketId}/call`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${agentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ counterId: ids.counterId }),
      });
      expect(res.status).toBe(200);

      const payload = await received;
      // Forme CONTRAT reçue par le CLIENT réel, validée contre le payloadSchema du CONTRAT.
      expect(ticketCalledEvent.payloadSchema.safeParse(payload).success).toBe(true);
      const p = payload as { ticket: Record<string, unknown>; counter: Record<string, unknown> };
      expect(p.ticket["id"]).toBe(ticketId);
      expect(p.ticket["status"]).toBe("CALLED");
      expect(p.ticket["agencyId"]).toBe(ids.agencyId);
      expect(p.counter["id"]).toBe(ids.counterId);
      expect(p.counter["label"]).toBe("Guichet 1");

      client.disconnect();
    },
    30_000
  );
});
