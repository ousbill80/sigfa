/**
 * Tests d'intégration — confinement du token DISPLAY sur le socket (CONTRACT-013)
 * + ségrégation par rôle des rooms (F-SEC-TV-01). Testcontainers réels PG 16 +
 * Redis 7. TDD rouge → vert.
 *
 * Prouve les assertions de sécurité du token d'affichage TV public :
 *   (a) un token DISPLAY ne peut PAS rejoindre une AUTRE agence que la sienne ;
 *   (b) une socket DISPLAY n'obtient JAMAIS un join hors de son claim (aucune
 *       room autre que la sienne) — corollaire du confinement lecture seule ;
 *   (c) un token DISPLAY obtient bien les events d'affichage de SA room
 *       (ticket:called), et ces payloads ne contiennent aucune PII.
 *
 * F-SEC-TV-01 (ségrégation par rôle, VRAI pipeline `createSocketServer` +
 * `createSocketBus`) :
 *   - DISPLAY reçoit `queue:updated` (affichage) SANS PII ;
 *   - DISPLAY reçoit `sync:state` (resync) SANS PII (via `buildSyncState` réel) ;
 *   - DISPLAY ne reçoit JAMAIS `alert:manager` (staff), MÊME abonné à sa room ;
 *   - une socket STAFF (AGENT) reçoit BIEN `alert:manager` (dashboards manager/COMEX).
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { SignJWT } from "jose";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { AddressInfo } from "net";
import type { Server as SocketServer } from "socket.io";
import { serve } from "@hono/node-server";
import type http from "http";
import { createApp } from "src/app.js";
import { createSocketServer, createRealtimeTestServer } from "src/services/socket-server.js";
import { createSocketBus } from "src/services/socket-bus.js";
import type { RealtimeBus } from "src/services/realtime.js";

const JWT_SECRET = "tv-display-socket-test-jwt-secret-at-least-32-chars!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let app: ReturnType<typeof createApp>;
let httpServer: http.Server;
let serverUrl: string;
let io: SocketServer;
let bus: RealtimeBus;
let bankId: string;
let agencyA: string;
let agencyB: string;

async function migrate(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='counter_status') THEN
        CREATE TYPE counter_status AS ENUM ('OPEN','PAUSED','CLOSED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='queue_status') THEN
        CREATE TYPE queue_status AS ENUM ('OPEN','PAUSED','CLOSED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_status') THEN
        CREATE TYPE ticket_status AS ENUM ('WAITING','CALLED','SERVING','DONE','NO_SHOW','ABANDONED','TRANSFERRED'); END IF;
    END $$;
  `);
  await client.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);`);
  await client.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);`);
  await client.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), status queue_status NOT NULL DEFAULT 'OPEN', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS counters (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL, status counter_status NOT NULL DEFAULT 'OPEN', agent_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), counter_id UUID, number INTEGER NOT NULL, display_number TEXT, status ticket_status NOT NULL DEFAULT 'WAITING', called_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), target_manager_id UUID
);`);
  await client.query(`CREATE TABLE IF NOT EXISTS kiosks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), current_session_id UUID, session_revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
}

/** Ouvre une session TV via la route publique et renvoie le token DISPLAY. */
async function mintDisplayToken(agencyId: string): Promise<string> {
  const res = await app.request("/api/v1/tv/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agencyId }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { accessToken: string; role: string };
  expect(body.role).toBe("DISPLAY");
  return body.accessToken;
}

/** Connecte un client Socket.io et attend la connexion. */
function connectClient(url: string, token: string): Promise<ClientSocket> {
  const socket: ClientSocket = ioClient(url, {
    transports: ["websocket"],
    auth: { token },
    reconnection: false,
  });
  return new Promise<ClientSocket>((resolve, reject) => {
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
    setTimeout(() => reject(new Error("connect timeout")), 10_000);
  });
}

/** Connecte un client + join la room agency et attend le join:ok. */
function connectAndJoin(token: string, agencyId: string): Promise<ClientSocket> {
  return connectClient(serverUrl, token).then(
    (socket) =>
      new Promise<ClientSocket>((resolve, reject) => {
        socket.emit("join:agency", { agencyId });
        socket.once("join:ok", () => resolve(socket));
        socket.once("error:forbidden", (m: string) => reject(new Error(m)));
        setTimeout(() => reject(new Error("join timeout")), 5_000);
      })
  );
}

/** Forge un JWT STAFF (AGENT) scope agence — pour prouver la réception staff. */
async function forgeStaffToken(agencyId: string): Promise<string> {
  return new SignJWT({ role: "AGENT", bankId, agencyIds: [agencyId] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(jwtSecretBytes);
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
  await migrate(db);

  const bank = await db.query(`INSERT INTO banks (name, slug) VALUES ('TvBank','tvbank-ws') RETURNING id`);
  bankId = (bank.rows[0] as { id: string }).id;
  const aA = await db.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'AgA') RETURNING id`, [bankId]);
  agencyA = (aA.rows[0] as { id: string }).id;
  const aB = await db.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'AgB') RETURNING id`, [bankId]);
  agencyB = (aB.rows[0] as { id: string }).id;

  app = createApp({ db, redis, jwtSecret: jwtSecretBytes });
  httpServer = serve({ fetch: app.fetch, port: 0 }) as unknown as http.Server;
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  const addr = httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${addr.port}`;
  // VRAI pipeline : createSocketServer (topologie de rooms, join staff) +
  // createSocketBus (routage allowlist affichage/staff). Le bus émet réellement.
  io = createSocketServer(httpServer, { db, redis, jwtSecret: jwtSecretBytes });
  bus = createSocketBus(io);
}, 180_000);

afterAll(async () => {
  io.close();
  await redis.quit();
  await db.end();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await pgContainer.stop();
  await redisContainer.stop();
}, 60_000);

describe("CONTRACT-013: token DISPLAY — handshake accepté, room propre uniquement", () => {
  it("CONTRACT-013: token DISPLAY → handshake WS accepté", async () => {
    const token = await mintDisplayToken(agencyA);
    const socket = await connectClient(serverUrl, token);
    expect(socket.connected).toBe(true);
    socket.disconnect();
  }, 30_000);

  // ── SEC assertion (a) : DISPLAY ne peut PAS rejoindre une AUTRE agence ──
  it("SEC-CONTRACT-013 (a): token DISPLAY agence A → join agency B REFUSÉ (error:forbidden)", async () => {
    const token = await mintDisplayToken(agencyA);
    const socket = await connectClient(serverUrl, token);
    const msg = await new Promise<string>((resolve, reject) => {
      socket.emit("join:agency", { agencyId: agencyB });
      socket.on("error:forbidden", (m: string) => resolve(m));
      socket.on("join:ok", () => reject(new Error("DISPLAY n'aurait PAS dû rejoindre une autre agence")));
      setTimeout(() => reject(new Error("timeout")), 5_000);
    });
    expect(msg).toContain("hors scope");
    socket.disconnect();
  }, 30_000);

  // ── Trou #2 : token DISPLAY EXPIRÉ → handshake WS refusé ──
  it("SEC-CONTRACT-013: token DISPLAY EXPIRÉ (exp dépassé) → handshake WS REFUSÉ (connect_error)", async () => {
    // Forge un JWT DISPLAY bien formé mais dont l'exp est déjà passé (TTL 12h non
    // renouvelable : à expiration, le WS doit refuser, sans quoi un écran révoqué
    // resterait connecté jusqu'au TTL).
    const expired = await new SignJWT({ role: "DISPLAY", bankId, agencyIds: [agencyA] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(`tv:${agencyA}`)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(jwtSecretBytes);
    const socket: ClientSocket = ioClient(serverUrl, {
      transports: ["websocket"],
      auth: { token: expired },
      reconnection: false,
    });
    await expect(
      new Promise<void>((resolve, reject) => {
        socket.on("connect", () => {
          socket.disconnect();
          reject(new Error("token DISPLAY expiré n'aurait PAS dû se connecter"));
        });
        socket.on("connect_error", () => resolve());
        setTimeout(() => reject(new Error("timeout")), 10_000);
      })
    ).resolves.toBeUndefined();
  }, 30_000);

  // ── Trou #3 : token DISPLAY FORGÉ (autre secret HS256) → handshake WS refusé ──
  it("SEC-CONTRACT-013: token DISPLAY bien formé signé avec un AUTRE secret HS256 → handshake WS REFUSÉ", async () => {
    // Vrai modèle de menace : un attaquant fabrique un JWT DISPLAY parfaitement
    // formé (claims valides, exp futur) mais signé avec un secret qu'il contrôle.
    const attackerSecret = new TextEncoder().encode(
      "attacker-controlled-secret-key-at-least-32-chars!!"
    );
    const forged = await new SignJWT({ role: "DISPLAY", bankId, agencyIds: [agencyA] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(`tv:${agencyA}`)
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(attackerSecret);
    const socket: ClientSocket = ioClient(serverUrl, {
      transports: ["websocket"],
      auth: { token: forged },
      reconnection: false,
    });
    await expect(
      new Promise<void>((resolve, reject) => {
        socket.on("connect", () => {
          socket.disconnect();
          reject(new Error("token DISPLAY forgé (autre secret) n'aurait PAS dû se connecter"));
        });
        socket.on("connect_error", () => resolve());
        setTimeout(() => reject(new Error("timeout")), 10_000);
      })
    ).resolves.toBeUndefined();
  }, 30_000);

  // ── SEC assertion (b) : DISPLAY confiné à sa propre room ──
  it("SEC-CONTRACT-013 (b): token DISPLAY agence A → join agency A ACCEPTÉ (sa propre room, la seule)", async () => {
    const token = await mintDisplayToken(agencyA);
    const socket = await connectClient(serverUrl, token);
    const msg = await new Promise<string>((resolve, reject) => {
      socket.emit("join:agency", { agencyId: agencyA });
      socket.on("join:ok", (m: string) => resolve(m));
      socket.on("error:forbidden", (m: string) => reject(new Error(`ne devrait pas être refusé: ${m}`)));
      setTimeout(() => reject(new Error("timeout")), 5_000);
    });
    expect(msg).toContain(`agency:${agencyA}`);
    socket.disconnect();
  }, 30_000);
});

describe("CONTRACT-013: token DISPLAY — reçoit les flux d'affichage de SA room (sans PII)", () => {
  // ── SEC assertion (c) : DISPLAY obtient les events d'affichage de sa room ──
  it("SEC-CONTRACT-013 (c): token DISPLAY reçoit ticket:called de SA room, payload sans PII", async () => {
    const token = await mintDisplayToken(agencyA);
    // Serveur de test éphémère (émetteur direct) : le handshake accepte le même
    // token DISPLAY, la room est la sienne.
    const testServer = await createRealtimeTestServer();
    const socket = await connectClient(testServer.url, token);
    await new Promise<void>((resolve, reject) => {
      socket.emit("join:agency", { agencyId: agencyA });
      socket.once("join:ok", () => resolve());
      setTimeout(() => reject(new Error("join timeout")), 5_000);
    });

    const payload = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.once("ticket:called", (p: unknown) => resolve(p as Record<string, unknown>));
      testServer.emitTicketCalled(agencyA);
      setTimeout(() => reject(new Error("timeout ticket:called")), 5_000);
    });

    // Le flux d'affichage arrive bien à la socket DISPLAY.
    expect(payload["ticket"]).toBeDefined();
    expect(payload["counter"]).toBeDefined();
    // Aucune PII (téléphone) dans le payload d'affichage.
    const flat = JSON.stringify(payload).toLowerCase();
    expect(flat).not.toContain("phone");
    expect(flat).not.toContain("phonenumber");

    socket.disconnect();
    await testServer.teardown();
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// F-SEC-TV-01 — ségrégation par rôle des rooms (VRAI pipeline bus + socket)
// ─────────────────────────────────────────────────────────────────────────────

/** UUID conforme aux payloads d'événements (pour les émissions directes du bus). */
function uuid(suffix: string): string {
  return `00000000-0000-4000-a000-0000000000${suffix}`;
}

/** Attend un événement OU un délai (résout `null` si rien n'arrive). */
function waitEventOrSilence<T>(
  socket: ClientSocket,
  event: string,
  ms: number
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    socket.once(event, (p: T) => resolve(p));
    setTimeout(() => resolve(null), ms);
  });
}

describe("F-SEC-TV-01: ségrégation par rôle — DISPLAY reçoit l'affichage, JAMAIS la supervision", () => {
  // ── Trou #1a : queue:updated (affichage) reçu par DISPLAY, sans PII (bus RÉEL) ──
  it("F-SEC-TV-01: DISPLAY reçoit queue:updated de SA room (bus réel), payload sans PII", async () => {
    const token = await mintDisplayToken(agencyA);
    const socket = await connectAndJoin(token, agencyA);

    const payload = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.once("queue:updated", (p: unknown) => resolve(p as Record<string, unknown>));
      bus.emit("queue:updated", agencyA, { queueId: uuid("04"), length: 5, estimate: 400 });
      setTimeout(() => reject(new Error("timeout queue:updated")), 5_000);
    });

    expect(payload["queueId"]).toBe(uuid("04"));
    expect(payload["length"]).toBe(5);
    const flat = JSON.stringify(payload).toLowerCase();
    expect(flat).not.toContain("phone");
    expect(flat).not.toContain("agentid");
    socket.disconnect();
  }, 30_000);

  // ── Trou #1b : sync:state (resync) reçu par DISPLAY via buildSyncState RÉEL, sans PII ──
  it("F-SEC-TV-01: DISPLAY reçoit sync:state (buildSyncState réel), aucune PII projetée", async () => {
    // Seed minimal pour un sync:state non trivial (queue + counter + ticket CALLED).
    const svc = await db.query(
      `INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','Ouv') RETURNING id`,
      [bankId, agencyA]
    );
    const serviceId = (svc.rows[0] as { id: string }).id;
    const q = await db.query(
      `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
      [bankId, agencyA, serviceId]
    );
    const queueId = (q.rows[0] as { id: string }).id;
    await db.query(
      `INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,1,'G1')`,
      [bankId, agencyA]
    );
    await db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, display_number, status, called_at)
       VALUES ($1,$2,$3,$4,1,'OC-001','CALLED',NOW())`,
      [bankId, agencyA, queueId, serviceId]
    );

    const token = await mintDisplayToken(agencyA);
    const socket = await connectAndJoin(token, agencyA);

    const state = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.once("sync:state", (p: unknown) => resolve(p as Record<string, unknown>));
      socket.emit("sync:request", { agencyId: agencyA });
      setTimeout(() => reject(new Error("timeout sync:state")), 5_000);
    });

    // Reconstruction d'affichage présente (recentCalls), mais AUCUNE PII.
    expect(state["agencyId"]).toBe(agencyA);
    expect(Array.isArray(state["recentCalls"])).toBe(true);
    const flat = JSON.stringify(state).toLowerCase();
    expect(flat).not.toContain("phone");
    expect(flat).not.toContain("phone_encrypted");
    expect(flat).not.toContain("phonehash");
    expect(flat).not.toContain("sms_consent");
    expect(flat).not.toContain("tracking");
    socket.disconnect();
  }, 30_000);

  // ── Trou #1c : DISPLAY ne reçoit JAMAIS alert:manager (supervision) ──
  it("F-SEC-TV-01: DISPLAY abonné à SA room ne reçoit JAMAIS alert:manager (métriques SLA/agentId)", async () => {
    const token = await mintDisplayToken(agencyA);
    const socket = await connectAndJoin(token, agencyA);

    // Listeners posés AVANT toute émission (pas de course d'enregistrement).
    const alertPromise = waitEventOrSilence(socket, "alert:manager", 1_500);
    const queuePromise = waitEventOrSilence<Record<string, unknown>>(socket, "queue:updated", 2_000);

    // Émission RÉELLE d'une alerte de supervision portant agentId + SLA…
    bus.emit("alert:manager", agencyA, {
      type: "AGENT_INACTIVE",
      payload: { agentId: uuid("05"), agencyId: agencyA, inactiveMinutes: 12 },
    });
    // …suivie d'un queue:updated : contrôle POSITIF prouvant que le canal fonctionne
    // (l'absence d'alerte n'est donc pas un faux négatif de timing/room vide).
    bus.emit("queue:updated", agencyA, { queueId: uuid("04"), length: 1, estimate: 2 });

    // DISPLAY ne rejoint PAS agency:{id}:staff → jamais d'alerte de supervision.
    expect(await alertPromise).toBeNull();
    // Le canal d'affichage (room publique), lui, transporte bien.
    expect(await queuePromise).not.toBeNull();
    socket.disconnect();
  }, 30_000);

  // ── Contrainte critique : une socket STAFF (AGENT) reçoit BIEN alert:manager ──
  it("F-SEC-TV-01: une socket STAFF (AGENT) reçoit alert:manager (dashboards manager/COMEX préservés)", async () => {
    const staffToken = await forgeStaffToken(agencyA);
    const staff = await connectAndJoin(staffToken, agencyA);

    const alert = await new Promise<Record<string, unknown>>((resolve, reject) => {
      staff.once("alert:manager", (p: unknown) => resolve(p as Record<string, unknown>));
      bus.emit("alert:manager", agencyA, {
        type: "SLA_BREACH",
        payload: { ticketId: uuid("01"), agencyId: agencyA },
      });
      setTimeout(() => reject(new Error("STAFF aurait dû recevoir alert:manager")), 5_000);
    });
    expect(alert["type"]).toBe("SLA_BREACH");
    staff.disconnect();
  }, 30_000);

  // ── Trou #5 : sync:request cross-agency par DISPLAY → refusé ──
  it("F-SEC-TV-01: token DISPLAY agence A → sync:request { agencyId: B } REFUSÉ (error:forbidden)", async () => {
    const token = await mintDisplayToken(agencyA);
    const socket = await connectAndJoin(token, agencyA);

    const msg = await new Promise<string>((resolve, reject) => {
      socket.emit("sync:request", { agencyId: agencyB });
      socket.on("error:forbidden", (m: string) => resolve(m));
      socket.on("sync:state", () => reject(new Error("DISPLAY n'aurait PAS dû obtenir l'état d'une AUTRE agence")));
      setTimeout(() => reject(new Error("timeout")), 5_000);
    });
    expect(msg).toContain("hors scope");
    socket.disconnect();
  }, 30_000);
});
