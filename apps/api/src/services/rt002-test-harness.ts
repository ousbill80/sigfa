/**
 * Harnais de test RT-002 — realtime-guarantees (NON couvert : support de test).
 *
 * Démarre PostgreSQL 16 + Redis 7 (Testcontainers RÉELS), applique le schéma
 * minimal du chemin `ticket:called` (banks/agencies/services/queues/counters/
 * tickets/kiosks) et fournit :
 *  - `startRtHarness()` : conteneurs + db + redis + secret JWT + fixtures ;
 *  - `bootRtInstance()` : UNE instance serveur réelle (serve() → createSocketServer
 *    avec adapter Redis ACTIF → createSocketBus → createApp) sur `port:0` — le
 *    pattern multi-instance partage le MÊME Redis Testcontainer ;
 *  - `connectAndJoin()` : client `socket.io-client` réel connecté + joint à la room.
 *
 * Base : pattern Testcontainers de `admin-test-harness.ts` (PG16 + Redis7).
 * Exclu de la couverture (support de test, jamais du code produit).
 *
 * @module
 */

import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { SignJWT } from "jose";
import { serve } from "@hono/node-server";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { AddressInfo } from "net";
import type http from "http";
import type { Server as SocketServer } from "socket.io";
import { createApp } from "src/app.js";
import { createSocketServer } from "src/services/socket-server.js";
import { createSocketBus } from "src/services/socket-bus.js";

/** Secret JWT partagé du harnais RT-002. */
export const RT_JWT_SECRET = "rt002-realtime-guarantees-jwt-secret-32chars!!";

/** Clés crypto de test (fail-fast au chargement du barrel database). */
process.env["PHONE_ENCRYPTION_KEY"] =
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  "2222222222222222222222222222222222222222222222222222222222222222";

/** Fixtures d'un tenant complet (banque → agence → service → file → 2 guichets). */
export interface RtFixtures {
  /** Banque. */
  bankId: string;
  /** Agence. */
  agencyId: string;
  /** Service. */
  serviceId: string;
  /** File. */
  queueId: string;
  /** Guichet 1. */
  counterId: string;
  /** Guichet 2 (course 2 agents). */
  counterId2: string;
}

/** Ressources démarrées du harnais RT-002. */
export interface RtHarness {
  /** Conteneur PostgreSQL. */
  pgContainer: StartedTestContainer;
  /** Conteneur Redis (PARTAGÉ par toutes les instances serveur). */
  redisContainer: StartedTestContainer;
  /** Client PG applicatif principal. */
  db: pg.Client;
  /** Client Redis principal. */
  redis: Redis;
  /** Secret JWT (bytes). */
  jwtSecretBytes: Uint8Array;
  /** Fixtures tenant. */
  ids: RtFixtures;
  /** URL de connexion PG (pour instancier des clients isolés — course d'agents). */
  pgUrl: string;
  /** URL de connexion Redis (pour instancier des clients partagés multi-instance). */
  redisUrl: string;
}

/** Une instance serveur RT-002 (serve + socket + bus + app). */
export interface RtInstance {
  /** URL HTTP/WS de l'instance. */
  url: string;
  /** Serveur Socket.io de l'instance (adapter Redis actif). */
  io: SocketServer;
  /** App Hono câblée au socket bus réel. */
  app: ReturnType<typeof createApp>;
  /** Serveur HTTP sous-jacent. */
  httpServer: http.Server;
  /** Arrête l'instance. */
  teardown: () => Promise<void>;
}

/**
 * Démarre PG16 + Redis7, applique le schéma et sème le tenant de test.
 *
 * @returns Ressources du harnais RT-002
 */
export async function startRtHarness(): Promise<RtHarness> {
  const pgContainer = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "sigfa",
      POSTGRES_PASSWORD: "sigfa_test",
      POSTGRES_DB: "sigfa_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2)
    )
    .start();
  const redisContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();

  const pgUrl = `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(
    5432
  )}/sigfa_test`;
  const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(
    6379
  )}`;

  const db = new pg.Client({ connectionString: pgUrl });
  await db.connect();
  await applyRtSchema(db);
  const ids = await seedTenant(db);

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const jwtSecretBytes = new TextEncoder().encode(RT_JWT_SECRET);

  return {
    pgContainer,
    redisContainer,
    db,
    redis,
    jwtSecretBytes,
    ids,
    pgUrl,
    redisUrl,
  };
}

/**
 * Arrête et nettoie toutes les ressources du harnais.
 *
 * @param h - Harnais à arrêter
 */
export async function stopRtHarness(h: RtHarness): Promise<void> {
  await h.redis.quit();
  await h.db.end();
  await h.pgContainer.stop();
  await h.redisContainer.stop();
}

/** Dépendances d'une instance serveur RT-002. */
export interface BootInstanceDeps {
  /** Client PG de l'instance (isolé pour la course d'agents). */
  db: pg.Client;
  /** Client Redis de l'instance (duplique en interne pour l'adapter pub/sub). */
  redis: Redis;
  /** Secret JWT. */
  jwtSecret: Uint8Array;
}

/**
 * Démarre UNE instance serveur réelle : serve() → createSocketServer (adapter
 * Redis ACTIF) → createSocketBus → createApp. L'app est câblée au socket bus
 * réel, donc l'appel HTTP diffuse par le VRAI chemin socket.
 *
 * @param deps - Client PG/Redis + secret JWT
 * @returns Instance prête (url, io, app, teardown)
 */
export async function bootRtInstance(deps: BootInstanceDeps): Promise<RtInstance> {
  const httpServer = serve({
    fetch: () => new Response("ok"),
    port: 0,
  }) as unknown as http.Server;
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  const addr = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  const io = createSocketServer(httpServer, {
    db: deps.db,
    redis: deps.redis,
    jwtSecret: deps.jwtSecret,
  });
  const bus = createSocketBus(io);
  const app = createApp({ db: deps.db, redis: deps.redis, jwtSecret: deps.jwtSecret, bus });

  return {
    url,
    io,
    app,
    httpServer,
    teardown: async () => {
      io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

/**
 * Forge un JWT AGENT scoping l'agence.
 *
 * @param secret    - Secret JWT (bytes)
 * @param bankId    - Banque
 * @param agencyIds - Agences accessibles
 * @param sub       - Sujet (userId), défaut agent de test
 * @returns JWT signé
 */
export async function forgeAgentToken(
  secret: Uint8Array,
  bankId: string,
  agencyIds: string[],
  sub = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
): Promise<string> {
  return new SignJWT({ role: "AGENT", bankId, agencyIds })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}

/** Options de connexion client (reconnexion pour le test de resync). */
export interface ConnectOptions {
  /** Active la reconnexion automatique socket.io (test de coupure/reprise). */
  reconnection?: boolean;
}

/**
 * Connecte un client `socket.io-client` réel et joint la room agency:{id}.
 *
 * @param url      - URL de l'instance
 * @param token    - JWT du client
 * @param agencyId - Agence à joindre
 * @param opts     - Options (reconnection)
 * @returns Socket client connecté et joint
 */
export function connectAndJoin(
  url: string,
  token: string,
  agencyId: string,
  opts: ConnectOptions = {}
): Promise<ClientSocket> {
  const socket: ClientSocket = ioClient(url, {
    transports: ["websocket"],
    auth: { token },
    reconnection: opts.reconnection ?? false,
  });
  return new Promise<ClientSocket>((resolve, reject) => {
    socket.on("connect", () => {
      socket.emit("join:agency", { agencyId });
    });
    socket.on("join:ok", () => resolve(socket));
    socket.on("connect_error", reject);
    setTimeout(() => reject(new Error("connect/join timeout")), 10_000);
  });
}

/** Insère un ticket WAITING et retourne son id. */
export async function insertWaitingTicket(
  db: pg.Client,
  ids: RtFixtures
): Promise<string> {
  const tracking = `t${Math.random().toString(36).slice(2)}`.padEnd(21, "0").slice(0, 21);
  const res = await db.query(
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, display_number, tracking_id, channel, status)
     VALUES ($1,$2,$3,$4,
       (SELECT COALESCE(MAX(number),0)+1 FROM tickets WHERE queue_id=$3),
       'OC-001', $5, 'KIOSK', 'WAITING')
     RETURNING id`,
    [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, tracking]
  );
  return (res.rows[0] as { id: string }).id;
}

/** Applique le schéma minimal du chemin ticket:called. */
async function applyRtSchema(db: pg.Client): Promise<void> {
  await db.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await db.query(`
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
  await db.query(`
    CREATE TABLE IF NOT EXISTS banks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      no_show_timeout_minutes INTEGER NOT NULL DEFAULT 3, queue_critical_threshold INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS agencies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL,
      sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS operations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id),
      code VARCHAR(6) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER,
      display_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, icon_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(service_id, code));`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS queues (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id),
      current_ticket_number INTEGER NOT NULL DEFAULT 0, is_open BOOLEAN NOT NULL DEFAULT true,
      status queue_status NOT NULL DEFAULT 'OPEN', open_at TEXT, close_at TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS counters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL,
      status counter_status NOT NULL DEFAULT 'OPEN', agent_id UUID, current_ticket_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await db.query(`
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
      UNIQUE (queue_id, number, issued_day));`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS kiosks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), current_session_id UUID, session_revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
}

/** Sème un tenant complet (banque, agence, service, file, 2 guichets). */
async function seedTenant(db: pg.Client): Promise<RtFixtures> {
  const bank = await db.query(
    `INSERT INTO banks (name, slug) VALUES ('TestBank','testbank-rt002') RETURNING id`
  );
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await db.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'Agency1') RETURNING id`,
    [bankId]
  );
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await db.query(
    `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'OC','Ouverture',10) RETURNING id`,
    [bankId, agencyId]
  );
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await db.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
    [bankId, agencyId, serviceId]
  );
  const queueId = (q.rows[0] as { id: string }).id;
  const ctr = await db.query(
    `INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,1,'Guichet 1') RETURNING id`,
    [bankId, agencyId]
  );
  const counterId = (ctr.rows[0] as { id: string }).id;
  const ctr2 = await db.query(
    `INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,2,'Guichet 2') RETURNING id`,
    [bankId, agencyId]
  );
  const counterId2 = (ctr2.rows[0] as { id: string }).id;
  return { bankId, agencyId, serviceId, queueId, counterId, counterId2 };
}
