/**
 * Tests d'intégration — MODEL-API-B (D6) : `selectNextForManager` (Testcontainers réel).
 *
 * PG 16 réel. Nommage strict : `MODEL-API-B: <description>`.
 *
 * Règle testée (priorité absolue D6) : quand un agent conseiller fait `call-next`,
 * il sert D'ABORD sa file personnelle (`target_manager_id = lui`, ordonnée priorité
 * porteur puis FIFO) ; SEULEMENT si elle est vide → la file de service (comportement
 * existant `selectNextPriority`).
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { selectNextForManager } from "src/services/queue-engine.js";
import { selectNextPriority } from "src/services/queue-engine.js";

let pgContainer: StartedTestContainer;
let db: pg.Client;

interface Fixtures {
  bankId: string;
  agencyId: string;
  serviceId: string;
  queueId: string;
  counterId: string;
  managerId: string;
}
let ids: Fixtures;

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
      -- Type RÉEL (migrations 0000/0011) : users.languages agent_language[], tickets.required_language agent_language.
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='agent_language') THEN
        CREATE TYPE agent_language AS ENUM ('FR','EN');
      END IF;
    END $$;
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS banks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
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
      current_ticket_number INTEGER NOT NULL DEFAULT 0, status queue_status NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID REFERENCES banks(id),
      email TEXT NOT NULL UNIQUE,
      languages agent_language[] NOT NULL DEFAULT '{}',
      is_relationship_manager BOOLEAN NOT NULL DEFAULT false,
      display_name TEXT, photo_url TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS counters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL,
      status counter_status NOT NULL DEFAULT 'OPEN', agent_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id),
      service_id UUID NOT NULL REFERENCES services(id), counter_id UUID,
      target_manager_id UUID REFERENCES users(id),
      number INTEGER NOT NULL, display_number TEXT, tracking_id CHAR(21) NOT NULL UNIQUE,
      channel ticket_channel NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING',
      priority ticket_priority NOT NULL DEFAULT 'STANDARD', required_language agent_language,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
}

async function insertFixtures(client: pg.Client): Promise<Fixtures> {
  const bank = await client.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await client.query(
    `INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','Ouverture') RETURNING id`,
    [bankId, agencyId]
  );
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await client.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
    [bankId, agencyId, serviceId]
  );
  const queueId = (q.rows[0] as { id: string }).id;
  const mgr = await client.query(
    `INSERT INTO users (bank_id, email, languages, is_relationship_manager, display_name)
     VALUES ($1,'mgr@t.ci',ARRAY['FR']::agent_language[],true,'Kofi A.') RETURNING id`,
    [bankId]
  );
  const managerId = (mgr.rows[0] as { id: string }).id;
  const ctr = await client.query(
    `INSERT INTO counters (bank_id, agency_id, number, label, agent_id) VALUES ($1,$2,1,'G1',$3) RETURNING id`,
    [bankId, agencyId, managerId]
  );
  const counterId = (ctr.rows[0] as { id: string }).id;
  return { bankId, agencyId, serviceId, queueId, counterId, managerId };
}

let seq = 0;
async function issueTicket(
  opts: { priority?: string; targetManagerId?: string | null } = {}
): Promise<string> {
  seq += 1;
  const res = await db.query(
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, target_manager_id, number,
                          tracking_id, channel, status, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'KIOSK','WAITING',$8) RETURNING id`,
    [
      ids.bankId, ids.agencyId, ids.queueId, ids.serviceId,
      opts.targetManagerId ?? null, seq,
      `trk${String(seq).padStart(18, "0")}`, opts.priority ?? "STANDARD",
    ]
  );
  return (res.rows[0] as { id: string }).id;
}

beforeAll(async () => {
  pgContainer = await new GenericContainer("postgres:16")
    .withEnvironment({ POSTGRES_USER: "sigfa", POSTGRES_PASSWORD: "sigfa_test", POSTGRES_DB: "sigfa_test" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  db = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test`,
  });
  await db.connect();
  await runMigrations(db);
  ids = await insertFixtures(db);
}, 180_000);

afterAll(async () => {
  await db.end();
  await pgContainer.stop();
}, 30_000);

beforeEach(async () => {
  await db.query(`DELETE FROM tickets`);
});

describe("MODEL-API-B: selectNextForManager — file conseiller priorité absolue (D6)", () => {
  it("MODEL-API-B: file perso non vide → sert la file perso avant la file de service", async () => {
    const selector = selectNextForManager(selectNextPriority);
    // File de service : un VIP (haute priorité) SANS target manager.
    const serviceVip = await issueTicket({ priority: "VIP", targetManagerId: null });
    // File perso du conseiller : un STANDARD.
    const personal = await issueTicket({ priority: "STANDARD", targetManagerId: ids.managerId });

    await db.query("BEGIN");
    const picked = await selector(ids.queueId, ids.counterId, db);
    await db.query("ROLLBACK");

    // Priorité ABSOLUE : même un VIP de service ne passe pas avant la file perso.
    expect(picked?.id).toBe(personal);
    expect(picked?.id).not.toBe(serviceVip);
  });

  it("MODEL-API-B: file perso vide → retombe sur la file de service (selectNextPriority)", async () => {
    const selector = selectNextForManager(selectNextPriority);
    const serviceStd = await issueTicket({ priority: "STANDARD", targetManagerId: null });

    await db.query("BEGIN");
    const picked = await selector(ids.queueId, ids.counterId, db);
    await db.query("ROLLBACK");

    expect(picked?.id).toBe(serviceStd);
  });

  it("MODEL-API-B: file perso ordonnée priorité porteur puis FIFO", async () => {
    const selector = selectNextForManager(selectNextPriority);
    await issueTicket({ priority: "STANDARD", targetManagerId: ids.managerId });
    const vipPersonal = await issueTicket({ priority: "VIP", targetManagerId: ids.managerId });

    await db.query("BEGIN");
    const picked = await selector(ids.queueId, ids.counterId, db);
    await db.query("ROLLBACK");

    expect(picked?.id).toBe(vipPersonal);
  });

  it("MODEL-API-B: agent NON conseiller → n'a pas de file perso, sert le service", async () => {
    // Guichet sans agent conseiller : agent_id NULL → aucune file perso.
    const ctr = await db.query(
      `INSERT INTO counters (bank_id, agency_id, number, label, agent_id) VALUES ($1,$2,2,'G2',NULL) RETURNING id`,
      [ids.bankId, ids.agencyId]
    );
    const counter2 = (ctr.rows[0] as { id: string }).id;
    const selector = selectNextForManager(selectNextPriority);
    // File de service : un VIP (haute priorité) sans conseiller ciblé.
    const serviceVip = await issueTicket({ priority: "VIP", targetManagerId: null });
    // Un ticket ciblant le conseiller (mais ce guichet n'est PAS le sien) : ne doit
    // recevoir aucun traitement prioritaire ici → le VIP de service passe devant.
    await issueTicket({ priority: "STANDARD", targetManagerId: ids.managerId });

    await db.query("BEGIN");
    const picked = await selector(ids.queueId, counter2, db);
    await db.query("ROLLBACK");

    // Guichet sans conseiller affecté → pure file de service (selectNextPriority) :
    // le VIP passe devant, la file perso d'un AUTRE conseiller n'est pas priorisée.
    expect(picked?.id).toBe(serviceVip);
  });
});
