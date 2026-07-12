/**
 * Harnais de test partagé des routeurs admin (API-008) — NON couvert (support de test).
 *
 * Démarre PostgreSQL 16 + Redis 7 (Testcontainers réels), crée le schéma minimal
 * du périmètre admin (banks, agencies, services, counters, queues, users, tickets,
 * notification_templates, audit_log, public_holidays, agency_exceptional_closures),
 * et fournit un forgeur de JWT. Utilisé par tous les tests d'intégration API-008.
 *
 * Exclu de la couverture (support de test, jamais du code produit).
 *
 * @module
 */

import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { SignJWT } from "jose";

/** Ressources démarrées du harnais. */
export interface AdminHarness {
  /** Conteneur PostgreSQL. */
  pgContainer: StartedTestContainer;
  /** Conteneur Redis. */
  redisContainer: StartedTestContainer;
  /** Client PG applicatif. */
  db: pg.Client;
  /** Client Redis. */
  redis: Redis;
  /** Secret JWT (bytes). */
  jwtSecretBytes: Uint8Array;
}

/** Secret JWT partagé des tests admin. */
export const ADMIN_JWT_SECRET = "admin-api008-jwt-secret-at-least-32-chars!!";

/**
 * Démarre les conteneurs et applique le schéma admin.
 *
 * @returns Ressources du harnais
 */
export async function startAdminHarness(): Promise<AdminHarness> {
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
  const db = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(
      5432
    )}/sigfa_test`,
  });
  await db.connect();
  await applyAdminSchema(db);
  const redis = new Redis(
    `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`
  );
  const jwtSecretBytes = new TextEncoder().encode(ADMIN_JWT_SECRET);
  return { pgContainer, redisContainer, db, redis, jwtSecretBytes };
}

/**
 * Arrête et nettoie les ressources du harnais.
 *
 * @param h - Harnais à arrêter
 */
export async function stopAdminHarness(h: AdminHarness): Promise<void> {
  await h.redis.quit();
  await h.db.end();
  await h.pgContainer.stop();
  await h.redisContainer.stop();
}

/**
 * Forge un JWT signé pour un rôle et un scope tenant donnés.
 *
 * @param secret    - Secret JWT (bytes)
 * @param role      - Rôle RBAC
 * @param sub       - Sujet (userId)
 * @param bankId    - Banque (null pour SUPER_ADMIN)
 * @param agencyIds - Agences accessibles
 * @returns JWT signé
 */
export async function forgeToken(
  secret: Uint8Array,
  role: string,
  sub: string,
  bankId: string | null,
  agencyIds: string[] = []
): Promise<string> {
  return new SignJWT({ role, bankId, agencyIds })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

/** Crée les types enum et tables du périmètre admin. */
async function applyAdminSchema(db: pg.Client): Promise<void> {
  await db.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='role') THEN
        CREATE TYPE role AS ENUM ('SUPER_ADMIN','BANK_ADMIN','AGENCY_DIRECTOR','MANAGER','AGENT','AUDITOR'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='counter_status') THEN
        CREATE TYPE counter_status AS ENUM ('OPEN','PAUSED','CLOSED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='queue_status') THEN
        CREATE TYPE queue_status AS ENUM ('OPEN','PAUSED','CLOSED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_status') THEN
        CREATE TYPE ticket_status AS ENUM ('WAITING','CALLED','SERVING','DONE','NO_SHOW','ABANDONED','TRANSFERRED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='agent_status') THEN
        CREATE TYPE agent_status AS ENUM ('AVAILABLE','SERVING','PAUSED','ABSENT','OFFLINE'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='notification_type') THEN
        CREATE TYPE notification_type AS ENUM ('TICKET_CONFIRMATION','POSITION_UPDATE','YOUR_TURN','DAILY_REPORT'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='notification_channel') THEN
        CREATE TYPE notification_channel AS ENUM ('SMS','WHATSAPP','PUSH'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='printer_status') THEN
        CREATE TYPE printer_status AS ENUM ('OK','PAPER_LOW','ERROR','OFFLINE'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='push_platform') THEN
        CREATE TYPE push_platform AS ENUM ('IOS','ANDROID','EXPO'); END IF;
    END $$;
  `);
  await db.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, theme JSONB NOT NULL DEFAULT '{}', queue_critical_threshold INTEGER NOT NULL DEFAULT 50, agent_inactivity_minutes INTEGER NOT NULL DEFAULT 15, no_show_timeout_minutes INTEGER NOT NULL DEFAULT 3, is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);`);
  await db.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, city TEXT, address TEXT, phone TEXT, timezone TEXT NOT NULL DEFAULT 'Africa/Abidjan', weekly_schedule JSONB NOT NULL DEFAULT '{}', is_template BOOLEAN NOT NULL DEFAULT false, is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);`);
  await db.query(`CREATE TABLE IF NOT EXISTS agency_exceptional_closures (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), date DATE NOT NULL, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await db.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER NOT NULL DEFAULT 10, display_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ, UNIQUE(agency_id, code));`);
  await db.query(`CREATE TABLE IF NOT EXISTS operations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), code VARCHAR(6) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER, display_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, icon_key TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(service_id, code));`);
  await db.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID REFERENCES banks(id), email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL DEFAULT 'x', first_name TEXT NOT NULL DEFAULT 'A', last_name TEXT NOT NULL DEFAULT 'B', role role NOT NULL DEFAULT 'AGENT', languages TEXT[] NOT NULL DEFAULT '{FR}', work_schedule JSONB, phone_encrypted TEXT, is_relationship_manager BOOLEAN NOT NULL DEFAULT false, display_name TEXT, photo_url TEXT, is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);`);
  await db.query(`CREATE TABLE IF NOT EXISTS agency_users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), user_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(agency_id, user_id));`);
  await db.query(`CREATE TABLE IF NOT EXISTS user_services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), user_id UUID NOT NULL REFERENCES users(id), service_id UUID NOT NULL REFERENCES services(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, service_id));`);
  await db.query(`CREATE TABLE IF NOT EXISTS counters (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL, status counter_status NOT NULL DEFAULT 'CLOSED', agent_id UUID REFERENCES users(id), current_ticket_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(agency_id, number));`);
  await db.query(`CREATE TABLE IF NOT EXISTS counter_services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), counter_id UUID NOT NULL REFERENCES counters(id), service_id UUID NOT NULL REFERENCES services(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(counter_id, service_id));`);
  await db.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), current_ticket_number INTEGER NOT NULL DEFAULT 0, is_open BOOLEAN NOT NULL DEFAULT true, status queue_status NOT NULL DEFAULT 'OPEN', open_at TEXT, close_at TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await db.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), operation_id UUID REFERENCES operations(id), target_manager_id UUID REFERENCES users(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, display_number TEXT, status ticket_status NOT NULL DEFAULT 'WAITING', phone_encrypted TEXT, phone_hash TEXT, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await db.query(`CREATE TABLE IF NOT EXISTS kiosks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), label TEXT NOT NULL, credentials_hash TEXT NOT NULL, last_seen TIMESTAMPTZ, printer_status printer_status NOT NULL DEFAULT 'OFFLINE', app_version TEXT, current_session_id UUID, session_expires_at TIMESTAMPTZ, session_revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await db.query(`CREATE TABLE IF NOT EXISTS retention_policies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), phone_retention_months INTEGER NOT NULL DEFAULT 13, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(bank_id));`);
  await db.query(`CREATE TABLE IF NOT EXISTS notification_consents (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), phone_encrypted TEXT NOT NULL, phone_hash TEXT NOT NULL, channel notification_channel NOT NULL, opted_in BOOLEAN NOT NULL DEFAULT false, opted_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(bank_id, phone_hash, channel));`);
  await db.query(`CREATE TABLE IF NOT EXISTS notification_templates (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), type notification_type NOT NULL, channel notification_channel NOT NULL, lang TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(bank_id, type, channel, lang));`);
  await db.query(`CREATE TABLE IF NOT EXISTS public_holidays (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), date DATE NOT NULL, name TEXT NOT NULL, description TEXT, is_approximate BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(date, name));`);
  await db.query(`CREATE TABLE IF NOT EXISTS audit_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), actor_id UUID, actor_role role, actor_email TEXT, action VARCHAR(500) NOT NULL, entity_type TEXT NOT NULL, entity_id UUID, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ip INET, diff JSONB);`);
  await db.query(`CREATE TABLE IF NOT EXISTS notification_devices (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), device_token TEXT NOT NULL UNIQUE, platform push_platform NOT NULL, phone_hash TEXT, last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await db.query(`CREATE TABLE IF NOT EXISTS agent_status_history (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), agent_id UUID NOT NULL REFERENCES users(id), from_status agent_status, to_status agent_status NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
}

/** Fixtures d'une banque + agence + directeur pour les tests. */
export interface BankFixture {
  /** Banque. */
  bankId: string;
  /** Agence. */
  agencyId: string;
  /** Directeur d'agence. */
  directorId: string;
}

/**
 * Crée une banque, une agence et un directeur (rôle AGENCY_DIRECTOR).
 *
 * @param db   - Client PG
 * @param slug - Slug unique de la banque
 * @returns Fixtures créées
 */
export async function seedBankAgency(
  db: pg.Client,
  slug: string
): Promise<BankFixture> {
  const bank = await db.query(
    `INSERT INTO banks (name, slug) VALUES ($1,$1) RETURNING id`,
    [slug]
  );
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await db.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'Agence') RETURNING id`,
    [bankId]
  );
  const agencyId = (agency.rows[0] as { id: string }).id;
  const dir = await db.query(
    `INSERT INTO users (bank_id, email, role) VALUES ($1,$2,'AGENCY_DIRECTOR') RETURNING id`,
    [bankId, `dir-${slug}@t.ci`]
  );
  const directorId = (dir.rows[0] as { id: string }).id;
  await db.query(
    `INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`,
    [bankId, agencyId, directorId]
  );
  return { bankId, agencyId, directorId };
}
