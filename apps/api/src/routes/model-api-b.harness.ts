/**
 * Harnais de schéma partagé — MODEL-API-B (support de test, hors couverture).
 *
 * Applique un schéma complet (banks/agencies/services/queues/operations/users/
 * agency_users/counters/tickets/audit_log) avec les colonnes conseiller de
 * MODEL-DB-B (`users.is_relationship_manager/display_name/photo_url`,
 * `tickets.target_manager_id`) — nécessaire aux tests d'émission + liste publique.
 *
 * Exclu de la couverture (jamais du code produit).
 *
 * @module
 */

import type pg from "pg";

/** Secret JWT partagé des tests MODEL-API-B. */
export const ADMIN_JWT_SECRET = "model-api-b-jwt-secret-at-least-32-chars!!";

/**
 * Crée les types enum et tables nécessaires aux tests conseiller.
 *
 * @param db - Client PG connecté
 */
export async function applyAdminSchemaForTest(db: pg.Client): Promise<void> {
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
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_priority') THEN
        CREATE TYPE ticket_priority AS ENUM ('STANDARD','PRIORITY','VIP','PMR','SENIOR'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_channel') THEN
        CREATE TYPE ticket_channel AS ENUM ('KIOSK','QR','MOBILE','WHATSAPP'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='agent_status') THEN
        CREATE TYPE agent_status AS ENUM ('AVAILABLE','SERVING','PAUSED','ABSENT','OFFLINE'); END IF;
      -- Type RÉEL (migrations 0000/0011) : users.languages agent_language[], tickets.required_language agent_language.
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='agent_language') THEN
        CREATE TYPE agent_language AS ENUM ('FR','EN'); END IF;
    END $$;
  `);
  await db.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, queue_critical_threshold INTEGER, no_show_timeout_minutes INTEGER NOT NULL DEFAULT 3, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);`);
  await db.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);`);
  await db.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER NOT NULL DEFAULT 10, is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ, UNIQUE(agency_id, code));`);
  await db.query(`CREATE TABLE IF NOT EXISTS operations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), code VARCHAR(6) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER, display_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, icon_key TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(service_id, code));`);
  await db.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID REFERENCES banks(id), email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL DEFAULT 'x', first_name TEXT NOT NULL DEFAULT 'A', last_name TEXT NOT NULL DEFAULT 'B', role role NOT NULL DEFAULT 'AGENT', languages agent_language[] NOT NULL DEFAULT '{FR}', work_schedule JSONB, phone_encrypted TEXT, is_relationship_manager BOOLEAN NOT NULL DEFAULT false, display_name TEXT, photo_url TEXT, is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);`);
  await db.query(`CREATE TABLE IF NOT EXISTS agency_users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), user_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(agency_id, user_id));`);
  await db.query(`CREATE TABLE IF NOT EXISTS user_services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), user_id UUID NOT NULL REFERENCES users(id), service_id UUID NOT NULL REFERENCES services(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, service_id));`);
  await db.query(`CREATE TABLE IF NOT EXISTS counters (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL, status counter_status NOT NULL DEFAULT 'CLOSED', agent_id UUID REFERENCES users(id), current_ticket_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(agency_id, number));`);
  await db.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), current_ticket_number INTEGER NOT NULL DEFAULT 0, is_open BOOLEAN NOT NULL DEFAULT true, status queue_status NOT NULL DEFAULT 'OPEN', open_at TEXT, close_at TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await db.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), operation_id UUID REFERENCES operations(id), target_manager_id UUID REFERENCES users(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, display_number TEXT, tracking_id CHAR(21) NOT NULL UNIQUE, local_uuid UUID UNIQUE, channel ticket_channel NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING', priority ticket_priority NOT NULL DEFAULT 'STANDARD', phone_encrypted TEXT, phone_hash TEXT, sms_consent BOOLEAN NOT NULL DEFAULT false, required_language agent_language, feedback_score INTEGER, feedback_comment TEXT, feedback_at TIMESTAMPTZ, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), called_at TIMESTAMPTZ, served_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, no_show_at TIMESTAMPTZ, wait_time_seconds INTEGER, service_time_seconds INTEGER, issued_day DATE GENERATED ALWAYS AS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (queue_id, number, issued_day));`);
  await db.query(`CREATE TABLE IF NOT EXISTS agent_status_history (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), agent_id UUID NOT NULL REFERENCES users(id), from_status agent_status, to_status agent_status NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await db.query(`CREATE TABLE IF NOT EXISTS audit_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), actor_id UUID, actor_role role, actor_email TEXT, action VARCHAR(500) NOT NULL, entity_type TEXT NOT NULL, entity_id UUID, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ip INET, diff JSONB);`);
}
