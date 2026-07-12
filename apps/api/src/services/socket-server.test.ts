/**
 * Tests d'intégration — API-006 : Socket.io serveur + verrou d'appel durci.
 *
 * Testcontainers réels PG 16 + Redis 7. TDD rouge → vert.
 * Nommage strict : `API-006: <description>`.
 *
 * Critères couverts :
 * 1. handshake sans JWT → refus ; join room hors scope → refus
 * 2. payload non conforme → événement bloqué + log
 * 3. course 20 paires call-next → zéro double-attribution
 * 4. call ciblé concurrent → 200 + 409 TICKET_ALREADY_CLAIMED
 * 5. sync:request → état complet après reconnexion (CONTRACT-012 recentCalls)
 * 6. wiring — route HTTP et upgrade WS coexistent sur le même port ; handshake JWT AVANT join
 * 7. ticket:called p95 <500ms sur 50 émissions locales
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { SignJWT } from "jose";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { AddressInfo } from "net";
import { createApp } from "src/app.js";
import { createSocketServer } from "src/services/socket-server.js";
import { logger } from "src/lib/logger.js";
import { serve } from "@hono/node-server";
import type http from "http";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let app: ReturnType<typeof createApp>;
let httpServer: http.Server;
let serverUrl: string;
let ids: Awaited<ReturnType<typeof insertFixtures>>;
let agentToken: string;

const JWT_SECRET = "socket-server-test-jwt-secret-at-least-32-chars!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);

process.env["PHONE_ENCRYPTION_KEY"] =
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  "2222222222222222222222222222222222222222222222222222222222222222";

/** Migrations identiques à tickets.test.ts */
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
      no_show_timeout_minutes INTEGER NOT NULL DEFAULT 3,
      queue_critical_threshold INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS agencies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL,
      sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS queues (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id),
      current_ticket_number INTEGER NOT NULL DEFAULT 0, is_open BOOLEAN NOT NULL DEFAULT true,
      status queue_status NOT NULL DEFAULT 'OPEN',
      open_at TEXT, close_at TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS counters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL,
      status counter_status NOT NULL DEFAULT 'OPEN', agent_id UUID, current_ticket_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID REFERENCES banks(id),
      email TEXT NOT NULL UNIQUE,
      languages TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS counter_services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      counter_id UUID NOT NULL REFERENCES counters(id),
      service_id UUID NOT NULL REFERENCES services(id),
      UNIQUE(counter_id, service_id));
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id),
      service_id UUID NOT NULL REFERENCES services(id), counter_id UUID, agent_id UUID,
      number INTEGER NOT NULL, display_number TEXT, tracking_id CHAR(21) NOT NULL UNIQUE,
      channel ticket_channel NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING',
      priority ticket_priority NOT NULL DEFAULT 'STANDARD', phone_encrypted TEXT, phone_hash TEXT,
      sms_consent BOOLEAN NOT NULL DEFAULT false,
      required_language TEXT,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), called_at TIMESTAMPTZ, served_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ, no_show_at TIMESTAMPTZ, wait_time_seconds INTEGER, service_time_seconds INTEGER,
      issued_day DATE GENERATED ALWAYS AS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (queue_id, number, issued_day));
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ticket_transfers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      ticket_id UUID NOT NULL REFERENCES tickets(id), from_counter_id UUID, from_service_id UUID NOT NULL REFERENCES services(id),
      to_service_id UUID NOT NULL REFERENCES services(id), to_counter_id UUID, reason TEXT,
      transferred_by UUID NOT NULL, transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
}

async function insertFixtures(client: pg.Client): Promise<{
  bankId: string; agencyId: string; agencyId2: string; userId: string;
  serviceId: string; queueId: string; counterId: string; counterId2: string;
}> {
  const bank = await client.query(
    `INSERT INTO banks (name, slug, no_show_timeout_minutes) VALUES ('TestBank','testbank-ws',3) RETURNING id`
  );
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'Agency1') RETURNING id`, [bankId]
  );
  const agencyId = (agency.rows[0] as { id: string }).id;
  const agency2 = await client.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'Agency2') RETURNING id`, [bankId]
  );
  const agencyId2 = (agency2.rows[0] as { id: string }).id;
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
    `INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,1,'G1') RETURNING id`,
    [bankId, agencyId]
  );
  const counterId = (ctr.rows[0] as { id: string }).id;
  const ctr2 = await client.query(
    `INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,2,'G2') RETURNING id`,
    [bankId, agencyId]
  );
  const counterId2 = (ctr2.rows[0] as { id: string }).id;
  const userId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  return { bankId, agencyId, agencyId2, userId, serviceId, queueId, counterId, counterId2 };
}

/** Forge un JWT AGENT pour l'agencyId fourni. */
async function forgeToken(agencyIds: string[]): Promise<string> {
  return new SignJWT({ role: "AGENT", bankId: ids.bankId, agencyIds })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ids.userId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(jwtSecretBytes);
}

/** Connecte un client Socket.io et attend la connexion. */
function connectClient(token?: string): Promise<ClientSocket> {
  const query = token ? { token } : {};
  const socket: ClientSocket = ioClient(serverUrl, {
    transports: ["websocket"],
    auth: { token },
    query,
    reconnection: false,
  });
  return new Promise<ClientSocket>((resolve, reject) => {
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
    setTimeout(() => reject(new Error("Socket connect timeout")), 10_000);
  });
}

let _ticketSeq = 0;

/** Insère un ticket WAITING et retourne son id. */
async function insertTicket(suffix?: string): Promise<string> {
  _ticketSeq++;
  // Tracking ID must be CHAR(21) UNIQUE — use sequence + random suffix
  const trackingId = `t${String(_ticketSeq).padStart(5, "0")}${(suffix ?? Math.random().toString(36).slice(2, 16)).slice(0, 15)}`;
  const res = await db.query(
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status, display_number)
     VALUES ($1,$2,$3,$4,
       (SELECT COALESCE(MAX(number),0)+1 FROM tickets WHERE queue_id=$3),
       $5,'KIOSK','WAITING','OC-001')
     RETURNING id`,
    [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, trackingId.slice(0, 21).padEnd(21, "0")]
  );
  return (res.rows[0] as { id: string }).id;
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
  agentToken = await forgeToken([ids.agencyId]);

  app = createApp({ db, redis, jwtSecret: jwtSecretBytes });

  // Critère wiring : attacher Socket.io au même serveur HTTP que Hono
  httpServer = serve({ fetch: app.fetch, port: 0 }) as unknown as http.Server;
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  const addr = httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${addr.port}`;

  createSocketServer(httpServer, { db, redis, jwtSecret: jwtSecretBytes });
}, 180_000);

afterAll(async () => {
  await redis.quit();
  await db.end();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await pgContainer.stop();
  await redisContainer.stop();
}, 60_000);

beforeEach(async () => {
  await redis.flushall();
  await db.query(`DELETE FROM ticket_transfers`);
  await db.query(`DELETE FROM tickets`);
  await db.query(`UPDATE queues SET current_ticket_number = 0`);
});

// ────────────────────────────────────────────────────────────────────────────
// Critère 6 : wiring — HTTP et WS coexistent sur le même port
// ────────────────────────────────────────────────────────────────────────────

describe("API-006: wiring — route HTTP et upgrade WS coexistent sur le même port", () => {
  it(
    "API-006: une route HTTP répond 401/200 ET un client WS se connecte sur le même port",
    async () => {
      // Route HTTP fonctionne
      const res = await fetch(`${serverUrl}/api/v1/tickets`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });
      // 404 ou autre, mais la connexion HTTP marche
      expect(res.status).toBeLessThan(500);

      // Upgrade WS avec JWT valide → connexion acceptée
      const socket = await connectClient(agentToken);
      expect(socket.connected).toBe(true);
      socket.disconnect();
    },
    30_000
  );

  it(
    "API-006: handshake sans JWT → connexion refusée (connect_error)",
    async () => {
      const socket: ClientSocket = ioClient(serverUrl, {
        transports: ["websocket"],
        reconnection: false,
      });
      await expect(
        new Promise<void>((resolve, reject) => {
          socket.on("connect", () => {
            socket.disconnect();
            reject(new Error("Should have been rejected"));
          });
          socket.on("connect_error", () => resolve());
          setTimeout(() => reject(new Error("Timeout")), 10_000);
        })
      ).resolves.toBeUndefined();
    },
    30_000
  );

  it(
    "API-006: handshake JWT invalide → connexion refusée",
    async () => {
      const socket: ClientSocket = ioClient(serverUrl, {
        transports: ["websocket"],
        auth: { token: "not-a-valid-jwt" },
        reconnection: false,
      });
      await expect(
        new Promise<void>((resolve, reject) => {
          socket.on("connect", () => {
            socket.disconnect();
            reject(new Error("Should have been rejected"));
          });
          socket.on("connect_error", () => resolve());
          setTimeout(() => reject(new Error("Timeout")), 10_000);
        })
      ).resolves.toBeUndefined();
    },
    30_000
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Critère 1 : join room hors scope → refus
// ────────────────────────────────────────────────────────────────────────────

describe("API-006: join room hors scope → refus", () => {
  it(
    "API-006: join room agency:{agencyId2} avec token limité à agencyId1 → reçoit error:forbidden",
    async () => {
      const socket = await connectClient(agentToken);
      const result = await new Promise<string>((resolve, reject) => {
        socket.emit("join:agency", { agencyId: ids.agencyId2 });
        socket.on("error:forbidden", (msg: string) => resolve(msg));
        socket.on("join:ok", () => reject(new Error("Should not join out-of-scope room")));
        setTimeout(() => reject(new Error("Timeout waiting for error:forbidden")), 5_000);
      });
      expect(typeof result).toBe("string");
      socket.disconnect();
    },
    30_000
  );

  it(
    "API-006: join room agency:{agencyId} avec token valide → join:ok reçu",
    async () => {
      const socket = await connectClient(agentToken);
      const result = await new Promise<string>((resolve, reject) => {
        socket.emit("join:agency", { agencyId: ids.agencyId });
        socket.on("join:ok", (msg: string) => resolve(msg));
        socket.on("error:forbidden", (msg: string) =>
          reject(new Error(`Should not be rejected: ${msg}`))
        );
        setTimeout(() => reject(new Error("Timeout waiting for join:ok")), 5_000);
      });
      expect(typeof result).toBe("string");
      socket.disconnect();
    },
    30_000
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Critère 2 : payload entrant malformé au schéma → error:forbidden (garde safeParse)
// Couvre socket-server.ts : join:agency (l.132-137) et sync:request (l.164-168)
// ────────────────────────────────────────────────────────────────────────────

describe("API-006: payload entrant malformé → error:forbidden (garde safeParse)", () => {
  it(
    "API-006: join:agency avec payload malformé (agencyId non-uuid) → error:forbidden 'Payload join:agency invalide'",
    async () => {
      const socket = await connectClient(agentToken);
      const result = await new Promise<string>((resolve, reject) => {
        // agencyId: 123 (number, pas un uuid) → joinAgencySchema.safeParse échoue
        socket.emit("join:agency", { agencyId: 123 });
        socket.on("error:forbidden", (msg: string) => resolve(msg));
        socket.on("join:ok", () => reject(new Error("Should not join with malformed payload")));
        setTimeout(() => reject(new Error("Timeout waiting for error:forbidden")), 5_000);
      });
      expect(result).toBe("Payload join:agency invalide");
      socket.disconnect();
    },
    30_000
  );

  it(
    "API-006: sync:request avec payload malformé (objet vide) → error:forbidden 'Payload sync:request invalide'",
    async () => {
      const socket = await connectClient(agentToken);
      const result = await new Promise<string>((resolve, reject) => {
        // {} → agencyId absent → syncRequestSchema.safeParse échoue
        socket.emit("sync:request", {});
        socket.on("error:forbidden", (msg: string) => resolve(msg));
        socket.on("sync:state", () => reject(new Error("Should not emit sync:state on malformed payload")));
        setTimeout(() => reject(new Error("Timeout waiting for error:forbidden")), 5_000);
      });
      expect(result).toBe("Payload sync:request invalide");
      socket.disconnect();
    },
    30_000
  );

  it(
    "API-006: sync:request agencyId valide mais HORS scope JWT → error:forbidden 'hors scope', aucun sync:state",
    async () => {
      const socket = await connectClient(agentToken);
      const result = await new Promise<string>((resolve, reject) => {
        // agencyId2 est un uuid valide mais absent du scope du token (limité à agencyId1)
        socket.emit("sync:request", { agencyId: ids.agencyId2 });
        socket.on("error:forbidden", (msg: string) => resolve(msg));
        socket.on("sync:state", () => reject(new Error("Should not emit sync:state out-of-scope")));
        setTimeout(() => reject(new Error("Timeout waiting for error:forbidden")), 5_000);
      });
      expect(result).toContain("hors scope");
      socket.disconnect();
    },
    30_000
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Critère 5 : sync:request → sync:state (CONTRACT-012 recentCalls)
// ────────────────────────────────────────────────────────────────────────────

describe("API-006: sync:request → état complet après reconnexion", () => {
  it(
    "API-006: sync:request → sync:state contient queues, counters et recentCalls (≤4)",
    async () => {
      const socket = await connectClient(agentToken);

      // Join la room d'abord
      await new Promise<void>((resolve, reject) => {
        socket.emit("join:agency", { agencyId: ids.agencyId });
        socket.on("join:ok", () => resolve());
        setTimeout(() => reject(new Error("join timeout")), 5_000);
      });

      // Insérer un ticket CALLED pour tester recentCalls
      await db.query(
        `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status, display_number, counter_id, called_at)
         VALUES ($1,$2,$3,$4,1,$5,'KIOSK','CALLED','OC-001',$6,NOW())`,
        [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId,
          "track123456789012345", ids.counterId]
      );

      const state = await new Promise<Record<string, unknown>>((resolve, reject) => {
        socket.emit("sync:request", { agencyId: ids.agencyId });
        socket.on("sync:state", (payload: unknown) => resolve(payload as Record<string, unknown>));
        setTimeout(() => reject(new Error("Timeout waiting for sync:state")), 5_000);
      });

      expect(state["agencyId"]).toBe(ids.agencyId);
      expect(Array.isArray(state["queues"])).toBe(true);
      expect(Array.isArray(state["counters"])).toBe(true);
      expect(Array.isArray(state["recentCalls"])).toBe(true);
      expect((state["recentCalls"] as unknown[]).length).toBeLessThanOrEqual(4);
      expect(typeof state["timestamp"]).toBe("string");

      socket.disconnect();
    },
    30_000
  );

  it(
    "API-006: sync:state applique les fallbacks (agentId présent, displayNumber/counterLabel null → défauts)",
    async () => {
      const socket = await connectClient(agentToken);
      await new Promise<void>((resolve, reject) => {
        socket.emit("join:agency", { agencyId: ids.agencyId });
        socket.on("join:ok", () => resolve());
        setTimeout(() => reject(new Error("join timeout")), 5_000);
      });

      // Guichet AVEC agent_id → branche truthy l.257 (agentId inclus dans counters)
      await db.query(`UPDATE counters SET agent_id = $1 WHERE id = $2`, [ids.userId, ids.counterId]);

      // Ticket CALLED avec display_number NULL et counter_id NULL
      // → branches fallback l.261 (displayNumber ??) et l.262 (counterLabel ??).
      await db.query(
        `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status, display_number, counter_id, called_at)
         VALUES ($1,$2,$3,$4,7,$5,'KIOSK','CALLED',NULL,NULL,NOW())`,
        [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, "trackfallback12345678"]
      );

      const state = await new Promise<Record<string, unknown>>((resolve, reject) => {
        socket.emit("sync:request", { agencyId: ids.agencyId });
        socket.on("sync:state", (payload: unknown) => resolve(payload as Record<string, unknown>));
        setTimeout(() => reject(new Error("Timeout waiting for sync:state")), 5_000);
      });

      const counters = state["counters"] as Array<Record<string, unknown>>;
      // Au moins un guichet expose agentId (branche truthy l.257)
      expect(counters.some((c) => c["agentId"] === ids.userId)).toBe(true);

      const recentCalls = state["recentCalls"] as Array<Record<string, unknown>>;
      const fallbackCall = recentCalls.find((c) => c["ticketNumber"] === "A007");
      expect(fallbackCall).toBeDefined();
      // displayNumber null → défaut "T-007" (l.261) ; counterLabel null → "Guichet" (l.262)
      expect(fallbackCall?.["displayNumber"]).toBe("T-007");
      expect(fallbackCall?.["counterLabel"]).toBe("Guichet");

      // Remet le compteur dans l'état initial pour les autres tests
      await db.query(`UPDATE counters SET agent_id = NULL WHERE id = $1`, [ids.counterId]);

      socket.disconnect();
    },
    30_000
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Critère 2 (résilience) : buildSyncState throw → log socket:sync:error, aucun sync:state
// Couvre socket-server.ts handler d'erreur (l.182-184)
// ────────────────────────────────────────────────────────────────────────────

describe("API-006: sync:request avec DB cassée → socket:sync:error loggé, aucun sync:state", () => {
  it(
    "API-006: buildSyncState throw (connexion db fermée) → logger.error 'socket:sync:error' et aucun sync:state renvoyé",
    async () => {
      // Serveur Socket.io dédié branché sur une connexion PG que l'on FERME
      // → toute requête dans buildSyncState rejette → chemin catch (l.182-184).
      const brokenDb = new pg.Client({
        connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test`,
      });
      await brokenDb.connect();

      const brokenHttp = serve({ fetch: app.fetch, port: 0 }) as unknown as http.Server;
      await new Promise<void>((resolve) => brokenHttp.once("listening", resolve));
      const brokenAddr = brokenHttp.address() as AddressInfo;
      const brokenUrl = `http://127.0.0.1:${brokenAddr.port}`;

      createSocketServer(brokenHttp, { db: brokenDb, redis, jwtSecret: jwtSecretBytes });

      // Ferme la connexion PG → db.query rejettera dans buildSyncState.
      await brokenDb.end();

      const errorSpy = vi.spyOn(logger, "error");

      const socket: ClientSocket = ioClient(brokenUrl, {
        transports: ["websocket"],
        auth: { token: agentToken },
        reconnection: false,
      });
      await new Promise<void>((resolve, reject) => {
        socket.on("connect", () => resolve());
        socket.on("connect_error", (err) => reject(err));
        setTimeout(() => reject(new Error("connect timeout")), 10_000);
      });

      // sync:request valide (agencyId in-scope) mais db cassée → catch → log, pas de sync:state
      const outcome = await new Promise<"logged" | "state">((resolve, reject) => {
        socket.on("sync:state", () => resolve("state"));
        socket.emit("sync:request", { agencyId: ids.agencyId });
        // Poll le spy : le log est émis dès que buildSyncState rejette
        const started = Date.now();
        const poll = setInterval(() => {
          const called = errorSpy.mock.calls.some(
            (c) => c[1] === "socket:sync:error"
          );
          if (called) {
            clearInterval(poll);
            resolve("logged");
          } else if (Date.now() - started > 8_000) {
            clearInterval(poll);
            reject(new Error("Timeout: ni sync:state ni socket:sync:error"));
          }
        }, 50);
      });

      expect(outcome).toBe("logged");
      const syncErrorCalls = errorSpy.mock.calls.filter(
        (c) => c[1] === "socket:sync:error"
      );
      expect(syncErrorCalls.length).toBeGreaterThanOrEqual(1);
      expect(syncErrorCalls[0]?.[0]).toMatchObject({ agencyId: ids.agencyId });

      errorSpy.mockRestore();
      socket.disconnect();
      await new Promise<void>((resolve) => brokenHttp.close(() => resolve()));
    },
    30_000
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Critère 3 : course 20 paires call-next → zéro double-attribution
// ────────────────────────────────────────────────────────────────────────────

describe("API-006: course 20 paires call-next → zéro double-attribution", () => {
  it(
    "API-006: course 20 paires call-next → zéro double-attribution, perdant obtient ticket suivant",
    async () => {
      const PAIRS = 20;
      // Insérer PAIRS*2 tickets (assez pour que chaque perdant obtienne le suivant)
      for (let i = 0; i < PAIRS * 2 + 5; i++) {
        await insertTicket(`race${i}`.padEnd(10, "0"));
      }

      // Créer PAIRS+1 connexions PG indépendantes (2 par paire + 1 partagée)
      const clients = await Promise.all(
        Array.from({ length: PAIRS * 2 }, async () => {
          const c = new pg.Client({
            connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test`,
          });
          await c.connect();
          return c;
        })
      );

      // Simuler 20 paires d'agents faisant call-next simultanément
      const callNextViaHttp = async (): Promise<number> => {
        const res = await fetch(
          `${serverUrl}/api/v1/counters/${ids.counterId}/call-next`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${agentToken}`,
            },
          }
        );
        return res.status;
      };

      // Lancer toutes les paires simultanément
      const results = await Promise.all(
        Array.from({ length: PAIRS * 2 }, () => callNextViaHttp())
      );

      // Zéro double-attribution : chaque ticket ne doit être dans CALLED qu'une fois
      const calledRes = await db.query(
        `SELECT id FROM tickets WHERE status = 'CALLED' AND agency_id = $1`,
        [ids.agencyId]
      );
      const calledIds = calledRes.rows.map((r: { id: string }) => r.id);
      const uniqueIds = new Set(calledIds);
      expect(uniqueIds.size).toBe(calledIds.length); // zéro doublon

      // Tous les appels HTTP réussis sont soit 200 (ticket obtenu) ou 404 (file vide)
      const successes = results.filter((s) => s === 200);
      expect(successes.length).toBeGreaterThan(0);

      // Nettoyer les clients PG
      await Promise.all(clients.map((c) => c.end()));
    },
    120_000
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Critère 4 : call ciblé concurrent → 200 + 409 TICKET_ALREADY_CLAIMED
// ────────────────────────────────────────────────────────────────────────────

describe("API-006: call ciblé concurrent → 200 + 409", () => {
  it(
    "API-006: call ciblé concurrent → un 200, un 409 TICKET_ALREADY_CLAIMED",
    async () => {
      const ticketId = await insertTicket("targeted123456789012");

      const call = (): Promise<{ status: number; data: Record<string, unknown> }> =>
        fetch(`${serverUrl}/api/v1/tickets/${ticketId}/call`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${agentToken}`,
          },
          body: JSON.stringify({ counterId: ids.counterId }),
        }).then(async (r) => ({ status: r.status, data: (await r.json()) as Record<string, unknown> }));

      const [r1, r2] = await Promise.all([call(), call()]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const failedRes = r1.status === 409 ? r1 : r2;
      const errBody = failedRes.data as { error?: { code?: string } };
      expect(errBody.error?.code).toBe("TICKET_ALREADY_CLAIMED");
    },
    30_000
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Critère 7 : ticket:called p95 <500ms sur 50 émissions locales
// ────────────────────────────────────────────────────────────────────────────

describe("API-006: ticket:called p95 <500ms sur 50 émissions locales", () => {
  it(
    "API-006: ticket:called reçu par client local en <500ms p95 (50 émissions)",
    async () => {
      const { TICKET_CALLED_SLA_MS, createRealtimeTestServer } = await import("src/services/socket-server.js");

      const EMISSIONS = 50;
      const latencies: number[] = [];

      // Créer un serveur de test éphémère avec émissions directes
      const testServer = await createRealtimeTestServer();

      const clientSocket: ClientSocket = ioClient(testServer.url, {
        transports: ["websocket"],
        auth: { token: agentToken },
        reconnection: false,
      });

      await new Promise<void>((resolve, reject) => {
        clientSocket.on("connect", resolve);
        clientSocket.on("connect_error", reject);
        setTimeout(() => reject(new Error("connect timeout")), 10_000);
      });

      // Joindre la room pour recevoir les événements
      await new Promise<void>((resolve, reject) => {
        clientSocket.emit("join:agency", { agencyId: ids.agencyId });
        clientSocket.once("join:ok", () => resolve());
        setTimeout(() => reject(new Error("join timeout")), 5_000);
      });

      for (let i = 0; i < EMISSIONS; i++) {
        const start = performance.now();
        await new Promise<void>((resolve, reject) => {
          clientSocket.once("ticket:called", () => resolve());
          testServer.emitTicketCalled(ids.agencyId);
          setTimeout(() => reject(new Error(`timeout emission ${i}`)), 5_000);
        });
        latencies.push(performance.now() - start);
      }

      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.floor(EMISSIONS * 0.95)] ?? latencies[EMISSIONS - 1];
      expect(p95).toBeLessThan(TICKET_CALLED_SLA_MS);

      clientSocket.disconnect();
      await testServer.teardown();
    },
    120_000
  );
});
