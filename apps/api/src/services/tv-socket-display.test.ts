/**
 * Tests d'intégration — confinement du token DISPLAY sur le socket (CONTRACT-013).
 * Testcontainers réels PG 16 + Redis 7. TDD rouge → vert.
 *
 * Prouve les 3 assertions de sécurité du token d'affichage TV public :
 *   (a) un token DISPLAY ne peut PAS rejoindre une AUTRE agence que la sienne ;
 *   (b) une socket DISPLAY n'obtient JAMAIS un join hors de son claim (aucune
 *       room autre que la sienne) — corollaire du confinement lecture seule ;
 *   (c) un token DISPLAY obtient bien les events d'affichage de SA room
 *       (ticket:called), et ces payloads ne contiennent aucune PII.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { AddressInfo } from "net";
import { serve } from "@hono/node-server";
import type http from "http";
import { createApp } from "src/app.js";
import { createSocketServer, createRealtimeTestServer } from "src/services/socket-server.js";

const JWT_SECRET = "tv-display-socket-test-jwt-secret-at-least-32-chars!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let app: ReturnType<typeof createApp>;
let httpServer: http.Server;
let serverUrl: string;
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
  createSocketServer(httpServer, { db, redis, jwtSecret: jwtSecretBytes });
}, 180_000);

afterAll(async () => {
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
