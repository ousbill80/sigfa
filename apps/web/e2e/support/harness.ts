/**
 * Harnais E2E réel (RT-003) — oriente un backend RÉEL pour Playwright.
 *
 * Démarre PostgreSQL 16 + Redis 7 (Testcontainers), applique le schéma du
 * périmètre ticket/kiosk (parité stricte avec le harnais d'intégration API-003),
 * seede une banque/agence/service/file/guichet/agent/borne, puis lance le
 * SERVEUR API RÉEL (`apps/api/dist/index.js`) en sous-processus avec
 * `REALTIME_MODE=real` (socket.io + scheduler) branché sur ces conteneurs.
 *
 * Aucun mock : l'app web parle à cette API réelle, les sockets sont réels.
 *
 * @module e2e/support/harness
 */
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { SignJWT } from "jose";

// Playwright charge ce module en CJS → `__dirname` disponible.
const HERE = __dirname;
/** Racine du monorepo (apps/web/e2e/support → ../../../..). */
const API_LAUNCHER = join(HERE, "api-launcher.mjs");

/** Secret JWT partagé (≥32 caractères — fail-fast API sinon). */
export const E2E_JWT_SECRET = "rt003-e2e-jwt-secret-at-least-32-chars!!";
/** Clés phone-cipher (64 hex = 32 octets) requises par les routes ticket. */
const PHONE_ENCRYPTION_KEY =
  "1111111111111111111111111111111111111111111111111111111111111111";
const PHONE_HASH_KEY =
  "2222222222222222222222222222222222222222222222222222222222222222";

/** Fixtures seedées, exposées aux specs via le fichier d'état. */
export interface E2eFixtures {
  bankId: string;
  agencyId: string;
  serviceId: string;
  queueId: string;
  counterId: string;
  agentId: string;
  kioskId: string;
  kioskSecret: string;
}

/** État complet du backend E2E, sérialisé pour les specs. */
export interface E2eBackend extends E2eFixtures {
  /** URL racine de l'API réelle (HTTP + WS). */
  apiOrigin: string;
  /** URL REST préfixée /api/v1 (base des clients de contrat). */
  apiBase: string;
  /** JWT agent (scope agence) pour l'authentification web. */
  agentToken: string;
}

/** Poignée interne des ressources à nettoyer. */
export interface E2eResources {
  pg: StartedTestContainer;
  redis: StartedTestContainer;
  api: ChildProcess;
  backend: E2eBackend;
}

/** Applique le schéma ticket/kiosk (parité harnais intégration API-003). */
async function applySchema(db: pg.Client): Promise<void> {
  await db.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='role') THEN
        CREATE TYPE role AS ENUM ('SUPER_ADMIN','BANK_ADMIN','AGENCY_DIRECTOR','MANAGER','AGENT','AUDITOR'); END IF;
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
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='agent_status') THEN
        CREATE TYPE agent_status AS ENUM ('AVAILABLE','SERVING','PAUSED','ABSENT','OFFLINE'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='printer_status') THEN
        CREATE TYPE printer_status AS ENUM ('OK','PAPER_LOW','ERROR','OFFLINE'); END IF;
    END $$;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS banks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      no_show_timeout_minutes INTEGER NOT NULL DEFAULT 3, queue_critical_threshold INTEGER NOT NULL DEFAULT 50,
      agent_inactivity_minutes INTEGER NOT NULL DEFAULT 15,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS agencies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL,
      sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS queues (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id),
      current_ticket_number INTEGER NOT NULL DEFAULT 0, is_open BOOLEAN NOT NULL DEFAULT true,
      status queue_status NOT NULL DEFAULT 'OPEN', open_at TEXT, close_at TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID REFERENCES banks(id),
      email TEXT NOT NULL UNIQUE, languages TEXT[] NOT NULL DEFAULT '{}',
      role role NOT NULL DEFAULT 'AGENT', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS counters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL,
      status counter_status NOT NULL DEFAULT 'OPEN', agent_id UUID, current_ticket_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS counter_services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      counter_id UUID NOT NULL REFERENCES counters(id), service_id UUID NOT NULL REFERENCES services(id),
      UNIQUE(counter_id, service_id));
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS agent_status_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), agent_id UUID NOT NULL REFERENCES users(id),
      from_status agent_status, to_status agent_status NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS kiosks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), label TEXT NOT NULL, credentials_hash TEXT NOT NULL,
      last_seen TIMESTAMPTZ, printer_status printer_status NOT NULL DEFAULT 'OK', app_version TEXT,
      current_session_id UUID, session_expires_at TIMESTAMPTZ, session_revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id),
      service_id UUID NOT NULL REFERENCES services(id), counter_id UUID, agent_id UUID,
      number INTEGER NOT NULL, display_number TEXT, tracking_id CHAR(21) NOT NULL UNIQUE,
      channel ticket_channel NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING',
      priority ticket_priority NOT NULL DEFAULT 'STANDARD', phone_encrypted TEXT, phone_hash TEXT,
      sms_consent BOOLEAN NOT NULL DEFAULT false, required_language TEXT,
      feedback_score INTEGER, feedback_comment TEXT, feedback_at TIMESTAMPTZ,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), called_at TIMESTAMPTZ, served_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ, no_show_at TIMESTAMPTZ, wait_time_seconds INTEGER, service_time_seconds INTEGER,
      issued_day DATE GENERATED ALWAYS AS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (queue_id, number, issued_day));
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ticket_transfers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      ticket_id UUID NOT NULL REFERENCES tickets(id), from_counter_id UUID,
      from_service_id UUID NOT NULL REFERENCES services(id), to_service_id UUID NOT NULL REFERENCES services(id),
      to_counter_id UUID, reason TEXT, transferred_by UUID NOT NULL,
      transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  // Agrégats NPS quotidiens (feedback public) — upsert sur index partiels.
  await db.query(`
    CREATE TABLE IF NOT EXISTS daily_agency_stats (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id),
      service_id UUID REFERENCES services(id), day DATE NOT NULL,
      feedback_count INTEGER NOT NULL DEFAULT 0, feedback_sum INTEGER NOT NULL DEFAULT 0,
      nps_promoters INTEGER NOT NULL DEFAULT 0, nps_passives INTEGER NOT NULL DEFAULT 0,
      nps_detractors INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS daily_agency_stats_all_svc
       ON daily_agency_stats (bank_id, agency_id, day) WHERE service_id IS NULL`
  );
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS daily_agency_stats_per_svc
       ON daily_agency_stats (bank_id, agency_id, service_id, day) WHERE service_id IS NOT NULL`
  );
}

/** Seede bank/agency/service/queue/counter/agent/kiosk et retourne les ids. */
async function seed(db: pg.Client): Promise<E2eFixtures> {
  const bank = await db.query(
    `INSERT INTO banks (name, slug) VALUES ('Banque du Commerce','oc') RETURNING id`
  );
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await db.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'Agence Plateau') RETURNING id`,
    [bankId]
  );
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await db.query(
    `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'OC','Ouverture de compte',10) RETURNING id`,
    [bankId, agencyId]
  );
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await db.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
    [bankId, agencyId, serviceId]
  );
  const queueId = (q.rows[0] as { id: string }).id;
  const agent = await db.query(
    `INSERT INTO users (bank_id, email, role) VALUES ($1,'agent@oc.ci','AGENT') RETURNING id`,
    [bankId]
  );
  const agentId = (agent.rows[0] as { id: string }).id;
  // Guichet affecté à l'agent + statut OPEN → call-next opérationnel.
  const ctr = await db.query(
    `INSERT INTO counters (bank_id, agency_id, number, label, status, agent_id) VALUES ($1,$2,1,'Guichet 3','OPEN',$3) RETURNING id`,
    [bankId, agencyId, agentId]
  );
  const counterId = (ctr.rows[0] as { id: string }).id;
  await db.query(
    `INSERT INTO counter_services (counter_id, service_id) VALUES ($1,$2)`,
    [counterId, serviceId]
  );
  // Agent AVAILABLE (le cycle ticket pilotera SERVING/AVAILABLE).
  await db.query(
    `INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status) VALUES ($1,$2,$3,'AVAILABLE')`,
    [bankId, agencyId, agentId]
  );
  // Borne (kiosk) avec une session ACTIVE forgée directement (current_session_id
  // renseigné, non révoquée). Le hash de credentials n'est pas utilisé par l'E2E
  // (aucun appel /kiosk/session) — placeholder non nul pour la contrainte NOT NULL.
  const kioskSecret = "kiosk-secret-e2e-1234567890";
  const kiosk = await db.query(
    `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash, printer_status,
                         current_session_id, session_expires_at, session_revoked_at)
     VALUES ($1,$2,'Borne 1','x','OK', gen_random_uuid(), now() + interval '12 hours', NULL)
     RETURNING id`,
    [bankId, agencyId]
  );
  const kioskId = (kiosk.rows[0] as { id: string }).id;
  return { bankId, agencyId, serviceId, queueId, counterId, agentId, kioskId, kioskSecret };
}

/** Forge un JWT agent (scope agence) signé avec le secret E2E. */
async function forgeAgentToken(fx: E2eFixtures): Promise<string> {
  const secret = new TextEncoder().encode(E2E_JWT_SECRET);
  return new SignJWT({ role: "AGENT", bankId: fx.bankId, agencyIds: [fx.agencyId] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(fx.agentId)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

/** Attend qu'une URL réponde 2xx (polling robuste, pas de sleep fixe). */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = `status ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout en attendant ${url} — dernière erreur : ${lastErr}`);
}

/**
 * Démarre les conteneurs + le serveur API réel et retourne les ressources.
 * @param apiPort - Port du serveur API réel.
 * @returns Les ressources démarrées (à passer à {@link stopHarness}).
 */
export async function startHarness(apiPort: number): Promise<E2eResources> {
  const pgContainer = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "sigfa",
      POSTGRES_PASSWORD: "sigfa_test",
      POSTGRES_DB: "sigfa_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  const redisContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();

  const dbUrl = `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test`;
  const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  await applySchema(db);
  const fx = await seed(db);
  await db.end();

  const redis = new Redis(redisUrl);
  await redis.flushall();
  await redis.quit();

  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const api = spawn(
    process.execPath,
    [API_LAUNCHER],
    {
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
        REDIS_URL: redisUrl,
        JWT_SECRET: E2E_JWT_SECRET,
        API_PORT: String(apiPort),
        REALTIME_MODE: "real",
        PHONE_ENCRYPTION_KEY,
        PHONE_HASH_KEY,
        NODE_ENV: "test",
      },
      stdio: ["ignore", "inherit", "inherit"],
    }
  );

  await waitForHttp(`${apiOrigin}/api/v1/health`, 60_000);

  const agentToken = await forgeAgentToken(fx);
  const backend: E2eBackend = {
    ...fx,
    apiOrigin,
    apiBase: `${apiOrigin}/api/v1`,
    agentToken,
  };
  return { pg: pgContainer, redis: redisContainer, api, backend };
}

/** Arrête le serveur API et les conteneurs. */
export async function stopHarness(res: E2eResources): Promise<void> {
  res.api.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  if (!res.api.killed) res.api.kill("SIGKILL");
  await res.pg.stop();
  await res.redis.stop();
}
