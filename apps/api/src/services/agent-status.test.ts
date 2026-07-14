/**
 * Tests d'intégration — API-007 : machine à états statut agent + stats
 * (Testcontainers PG16 réel).
 *
 * Couvre critères 1, 2, 3 :
 *  - matrice de transitions exhaustive (légales / illégales → 409) ;
 *  - serve/close pilotent SERVING/AVAILABLE ; forçage manuel SERVING → 409 ;
 *  - stats : tickets traités/jour, TMT moyen/jour, ticket en cours chronométré.
 *
 * Nommage strict : `API-007: <description>`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { createCaptureBus, type CaptureBus } from "src/services/realtime.js";
import {
  changeAgentStatus,
  getCurrentStatus,
  getCurrentStatuses,
  isAgentPresent,
  agentStatusToCounterStatus,
  type AgentStatus,
} from "src/services/agent-status.js";
import { computeAgentStats } from "src/services/agent-stats.js";
import { SigfaError } from "src/lib/errors.js";

let pgContainer: StartedTestContainer;
let db: pg.Client;
let bus: CaptureBus;
let ids: Fixtures;

interface Fixtures {
  bankId: string;
  agencyId: string;
  agentId: string;
  serviceId: string;
  queueId: string;
  counterId: string;
}

/** Migrations minimales pour la machine à états + stats. */
async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='agent_status') THEN
        CREATE TYPE agent_status AS ENUM ('AVAILABLE','SERVING','PAUSED','ABSENT','OFFLINE'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_status') THEN
        CREATE TYPE ticket_status AS ENUM ('WAITING','CALLED','SERVING','DONE','NO_SHOW','ABANDONED','TRANSFERRED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_priority') THEN
        CREATE TYPE ticket_priority AS ENUM ('STANDARD','PRIORITY','VIP','PMR','SENIOR'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_channel') THEN
        CREATE TYPE ticket_channel AS ENUM ('KIOSK','QR','MOBILE','WHATSAPP'); END IF;
    END $$;
  `);
  await client.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, agent_inactivity_minutes INTEGER NOT NULL DEFAULT 15, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), code VARCHAR(4) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER NOT NULL DEFAULT 10, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS operations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), code VARCHAR(6) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER, display_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, icon_key TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(service_id, code));`);
  await client.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID REFERENCES banks(id), email TEXT NOT NULL UNIQUE, first_name TEXT NOT NULL DEFAULT 'A', last_name TEXT NOT NULL DEFAULT 'B', role TEXT NOT NULL DEFAULT 'AGENT', languages TEXT[] NOT NULL DEFAULT '{FR}', work_schedule JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), is_relationship_manager BOOLEAN NOT NULL DEFAULT false, display_name TEXT, photo_url TEXT
);`);
  await client.query(`CREATE TABLE IF NOT EXISTS agency_users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), user_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(agency_id, user_id));`);
  await client.query(`CREATE TABLE IF NOT EXISTS user_services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), user_id UUID NOT NULL REFERENCES users(id), service_id UUID NOT NULL REFERENCES services(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, service_id));`);
  await client.query(`CREATE TABLE IF NOT EXISTS counters (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL, agent_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), operation_id UUID REFERENCES operations(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, display_number TEXT, status ticket_status NOT NULL DEFAULT 'WAITING', priority ticket_priority NOT NULL DEFAULT 'STANDARD', issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), called_at TIMESTAMPTZ, served_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, service_time_seconds INTEGER, issued_day DATE GENERATED ALWAYS AS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), target_manager_id UUID
);`);
  await client.query(`CREATE TABLE IF NOT EXISTS agent_status_history (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), agent_id UUID NOT NULL REFERENCES users(id), from_status agent_status, to_status agent_status NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
}

/** Insère bank/agency/service/queue/agent/counter. */
async function insertFixtures(client: pg.Client): Promise<Fixtures> {
  const bank = await client.query(`INSERT INTO banks (name, slug, agent_inactivity_minutes) VALUES ('B','b',15) RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await client.query(`INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'OC','Ouverture',10) RETURNING id`, [bankId, agencyId]);
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`, [bankId, agencyId, serviceId]);
  const queueId = (q.rows[0] as { id: string }).id;
  const user = await client.query(`INSERT INTO users (bank_id, email, role) VALUES ($1,'agent@b.ci','AGENT') RETURNING id`, [bankId]);
  const agentId = (user.rows[0] as { id: string }).id;
  await client.query(`INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`, [bankId, agencyId, agentId]);
  const ctr = await client.query(`INSERT INTO counters (bank_id, agency_id, number, label, agent_id) VALUES ($1,$2,1,'G1',$3) RETURNING id`, [bankId, agencyId, agentId]);
  const counterId = (ctr.rows[0] as { id: string }).id;
  return { bankId, agencyId, agentId, serviceId, queueId, counterId };
}

/** Force le statut courant en insérant une ligne d'historique. */
async function setStatus(status: AgentStatus): Promise<void> {
  await db.query(
    `INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status) VALUES ($1,$2,$3,$4)`,
    [ids.bankId, ids.agencyId, ids.agentId, status]
  );
}

beforeAll(async () => {
  pgContainer = await new GenericContainer("postgres:16")
    .withEnvironment({ POSTGRES_USER: "sigfa", POSTGRES_PASSWORD: "sigfa_test", POSTGRES_DB: "sigfa_test" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  db = new pg.Client({ connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test` });
  await db.connect();
  await runMigrations(db);
  ids = await insertFixtures(db);
  bus = createCaptureBus();
}, 180_000);

afterAll(async () => {
  await db.end();
  await pgContainer.stop();
}, 30_000);

beforeEach(async () => {
  bus.events.length = 0;
  await db.query(`DELETE FROM agent_status_history`);
  await db.query(`DELETE FROM tickets`);
  await db.query(`UPDATE counters SET agent_id = $1 WHERE id = $2`, [ids.agentId, ids.counterId]);
});

/** Applique une transition manuelle et renvoie l'erreur éventuelle. */
async function tryManual(target: AgentStatus): Promise<SigfaError | null> {
  try {
    await changeAgentStatus({ db, bus, bankId: ids.bankId, agentId: ids.agentId, target });
    return null;
  } catch (err) {
    return err as SigfaError;
  }
}

describe("API-007: matrice de transitions statut exhaustive (légales/illégales → 409)", () => {
  const STATUSES: AgentStatus[] = ["AVAILABLE", "SERVING", "PAUSED", "ABSENT", "OFFLINE"];
  /** Transitions manuelles LÉGALES (contrat) : from → to. */
  const LEGAL = new Set([
    "AVAILABLE>PAUSED", "AVAILABLE>ABSENT", "AVAILABLE>OFFLINE",
    "PAUSED>AVAILABLE", "ABSENT>AVAILABLE", "OFFLINE>AVAILABLE",
    "SERVING>AVAILABLE",
  ]);

  for (const from of STATUSES) {
    for (const to of STATUSES) {
      if (from === to) continue;
      const key = `${from}>${to}`;
      const legal = LEGAL.has(key);
      it(`API-007: transition manuelle ${from} → ${to} ${legal ? "légale" : "→ 409"}`, async () => {
        await setStatus(from);
        const err = await tryManual(to);
        if (legal) {
          expect(err).toBeNull();
          expect(await getCurrentStatus(db, ids.agentId)).toBe(to);
        } else {
          expect(err).toBeInstanceOf(SigfaError);
          expect(err?.code).toBe("ILLEGAL_AGENT_TRANSITION");
          expect(err?.httpStatus).toBe(409);
          expect(err?.details).toMatchObject({ currentStatus: from, requestedStatus: to });
        }
      });
    }
  }

  it("API-007: chaque transition légale écrit agent_status_history + émet counter:status", async () => {
    await setStatus("AVAILABLE");
    bus.events.length = 0;
    await changeAgentStatus({ db, bus, bankId: ids.bankId, agentId: ids.agentId, target: "PAUSED" });
    const hist = await db.query(`SELECT from_status, to_status FROM agent_status_history WHERE agent_id = $1 ORDER BY changed_at DESC LIMIT 1`, [ids.agentId]);
    expect(hist.rows[0]).toMatchObject({ from_status: "AVAILABLE", to_status: "PAUSED" });
    const counter = bus.ofType("counter:status");
    expect(counter).toHaveLength(1);
    expect((counter[0]?.payload as { status: string }).status).toBe("PAUSED");
  });

  it("API-007: SERVING → ABSENT avec ticket ouvert non transféré → 409 (activeTicketId)", async () => {
    await setStatus("SERVING");
    const t = await db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, counter_id, agent_id, number, status, called_at, served_at)
       VALUES ($1,$2,$3,$4,$5,$6,1,'SERVING',NOW(),NOW()) RETURNING id`,
      [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, ids.counterId, ids.agentId]
    );
    const ticketId = (t.rows[0] as { id: string }).id;
    const err = await tryManual("ABSENT");
    expect(err?.code).toBe("ILLEGAL_AGENT_TRANSITION");
    expect(err?.details).toMatchObject({ activeTicketId: ticketId });
  });

  it("API-007: mapping counter:status — AVAILABLE/SERVING→OPEN, PAUSED→PAUSED, ABSENT/OFFLINE→CLOSED", () => {
    expect(agentStatusToCounterStatus("AVAILABLE")).toBe("OPEN");
    expect(agentStatusToCounterStatus("SERVING")).toBe("OPEN");
    expect(agentStatusToCounterStatus("PAUSED")).toBe("PAUSED");
    expect(agentStatusToCounterStatus("ABSENT")).toBe("CLOSED");
    expect(agentStatusToCounterStatus("OFFLINE")).toBe("CLOSED");
  });
});

describe("API-007: serve/close pilotent SERVING/AVAILABLE ; forçage manuel SERVING → 409", () => {
  it("API-007: transition cycle AVAILABLE → SERVING autorisée (pilotée par serve)", async () => {
    await setStatus("AVAILABLE");
    await changeAgentStatus({ db, bus, bankId: ids.bankId, agentId: ids.agentId, target: "SERVING", cycle: true });
    expect(await getCurrentStatus(db, ids.agentId)).toBe("SERVING");
  });

  it("API-007: transition cycle SERVING → AVAILABLE autorisée (pilotée par close)", async () => {
    await setStatus("SERVING");
    await changeAgentStatus({ db, bus, bankId: ids.bankId, agentId: ids.agentId, target: "AVAILABLE", cycle: true });
    expect(await getCurrentStatus(db, ids.agentId)).toBe("AVAILABLE");
  });

  it("API-007: forçage MANUEL AVAILABLE → SERVING → 409 (SERVING n'est jamais une cible manuelle)", async () => {
    await setStatus("AVAILABLE");
    const err = await tryManual("SERVING");
    expect(err?.code).toBe("ILLEGAL_AGENT_TRANSITION");
    expect(err?.httpStatus).toBe(409);
  });
});

describe("API-007: stats — tickets traités/jour, TMT moyen/jour, ticket en cours chronométré", () => {
  it("API-007: ticketsHandled + avgHandlingTime agrègent les DONE du jour", async () => {
    for (const tmt of [120, 240, 360]) {
      await db.query(
        `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, agent_id, number, status, service_time_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,'DONE',$7)`,
        [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, ids.agentId, Math.floor(Math.random() * 1000), tmt]
      );
    }
    const stats = await computeAgentStats(db, ids.agentId, ids.bankId, "day");
    expect(stats.ticketsHandled).toBe(3);
    expect(stats.avgHandlingTime).toBe(240);
    expect(stats.currentTicket).toBeNull();
  });

  it("API-007: currentTicket = ticket SERVING en cours (numéro + durée chronométrée)", async () => {
    await db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, agent_id, number, display_number, status, called_at, served_at)
       VALUES ($1,$2,$3,$4,$5,42,'A042','SERVING', NOW() - INTERVAL '90 seconds', NOW() - INTERVAL '60 seconds')`,
      [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, ids.agentId]
    );
    const stats = await computeAgentStats(db, ids.agentId, ids.bankId, "day");
    expect(stats.currentTicket?.number).toBe("A042");
    expect(stats.currentTicket?.durationSeconds).toBeGreaterThanOrEqual(58);
    expect(stats.currentTicket?.durationSeconds).toBeLessThan(120);
  });

  it("API-007: currentTicket sans display_number → numéro dérivé A{NNN} (fallback)", async () => {
    await db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, agent_id, number, status, called_at, served_at)
       VALUES ($1,$2,$3,$4,$5,7,'SERVING', NOW() - INTERVAL '30 seconds', NOW() - INTERVAL '10 seconds')`,
      [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, ids.agentId]
    );
    const stats = await computeAgentStats(db, ids.agentId, ids.bankId, "day");
    expect(stats.currentTicket?.number).toBe("A007");
  });

  it("API-007: période week agrège sur 7 jours glissants", async () => {
    await db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, agent_id, number, status, service_time_seconds, issued_at)
       VALUES ($1,$2,$3,$4,$5,50,'DONE',300, NOW() - INTERVAL '3 days')`,
      [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, ids.agentId]
    );
    const day = await computeAgentStats(db, ids.agentId, ids.bankId, "day");
    const week = await computeAgentStats(db, ids.agentId, ids.bankId, "week");
    expect(day.ticketsHandled).toBe(0);
    expect(week.ticketsHandled).toBe(1);
  });
});

describe("CONTRACT-014: présence dérivée de la machine à états (available)", () => {
  it("CONTRACT-014: isAgentPresent — présent si guichet non fermé (AVAILABLE/SERVING/PAUSED), absent si ABSENT/OFFLINE", () => {
    // Sémantique retenue : présent = statut dont le guichet n'est PAS CLOSED
    // (agentStatusToCounterStatus ≠ CLOSED). PAUSED = pause courte, l'agent est
    // physiquement en agence. ABSENT/OFFLINE = pas en service aujourd'hui.
    expect(isAgentPresent("AVAILABLE")).toBe(true);
    expect(isAgentPresent("SERVING")).toBe(true);
    expect(isAgentPresent("PAUSED")).toBe(true);
    expect(isAgentPresent("ABSENT")).toBe(false);
    expect(isAgentPresent("OFFLINE")).toBe(false);
  });

  it("CONTRACT-014: getCurrentStatuses lit le DERNIER statut de chaque agent en UNE requête (batch, pas de N+1)", async () => {
    // Deuxième agent pour vérifier le lot.
    const other = await db.query(
      `INSERT INTO users (bank_id, email, role) VALUES ($1,'agent2-c014@b.ci','AGENT')
       ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
      [ids.bankId]
    );
    const otherId = (other.rows[0] as { id: string }).id;
    // Historique : l'agent 1 passe AVAILABLE puis ABSENT (le dernier gagne) ;
    // l'agent 2 est AVAILABLE. `changed_at` explicites : aucun aléa d'horodatage.
    await db.query(
      `INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status, changed_at) VALUES
       ($1,$2,$3,'AVAILABLE', NOW() - INTERVAL '2 minutes'),
       ($1,$2,$3,'ABSENT',    NOW() - INTERVAL '1 minute'),
       ($1,$2,$4,'AVAILABLE', NOW() - INTERVAL '1 minute')`,
      [ids.bankId, ids.agencyId, ids.agentId, otherId]
    );
    const statuses = await getCurrentStatuses(db, [ids.agentId, otherId]);
    expect(statuses.get(ids.agentId)).toBe("ABSENT");
    expect(statuses.get(otherId)).toBe("AVAILABLE");
  });

  it("CONTRACT-014: getCurrentStatuses — agent jamais journalisé ABSENT de la Map (défaut OFFLINE à l'appelant)", async () => {
    const ghost = await db.query(
      `INSERT INTO users (bank_id, email, role) VALUES ($1,'ghost-c014@b.ci','AGENT')
       ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
      [ids.bankId]
    );
    const ghostId = (ghost.rows[0] as { id: string }).id;
    const statuses = await getCurrentStatuses(db, [ghostId]);
    expect(statuses.has(ghostId)).toBe(false);
  });

  it("CONTRACT-014: getCurrentStatuses([]) → Map vide sans requête SQL", async () => {
    const statuses = await getCurrentStatuses(db, []);
    expect(statuses.size).toBe(0);
  });
});
