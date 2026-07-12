/**
 * Tests d'intégration — API-007 : routes /agents (Testcontainers PG16 réel via app).
 *
 * Couvre critères 1, 2, 3 côté HTTP + tenant-isolation :
 *  - POST /agents/:id/status : 200 transitions légales, 409 illégales,
 *    forçage SERVING → 409, self-rule ;
 *  - GET /agents/:id/stats : AGENT self-only (403 sur autrui), MANAGER scope ;
 *  - tenant-isolation : lecture/écriture d'un agent hors scope → refus.
 *
 * Nommage strict : `API-007: <description>`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { SignJWT } from "jose";
import { createApp } from "src/app.js";
import { createCaptureBus, type CaptureBus } from "src/services/realtime.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let bus: CaptureBus;
let app: ReturnType<typeof createApp>;
let fx: Fixtures;

const JWT_SECRET = "agents-jwt-secret-at-least-32-chars-long!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);

interface Fixtures {
  bankId: string;
  agencyId: string;
  agentId: string;
  otherAgentId: string;
  serviceId: string;
  queueId: string;
  counterId: string;
  otherBankId: string;
  otherBankAgencyId: string;
  otherBankAgentId: string;
}

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
  await client.query(`CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id), service_id UUID NOT NULL REFERENCES services(id), operation_id UUID REFERENCES operations(id), counter_id UUID, agent_id UUID, number INTEGER NOT NULL, display_number TEXT, status ticket_status NOT NULL DEFAULT 'WAITING', priority ticket_priority NOT NULL DEFAULT 'STANDARD', called_at TIMESTAMPTZ, served_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, service_time_seconds INTEGER, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), issued_day DATE GENERATED ALWAYS AS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED, wait_time_seconds INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), target_manager_id UUID
);`);
  await client.query(`CREATE TABLE IF NOT EXISTS agent_status_history (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), agency_id UUID NOT NULL REFERENCES agencies(id), agent_id UUID NOT NULL REFERENCES users(id), from_status agent_status, to_status agent_status NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
}

async function seedBank(client: pg.Client, slug: string): Promise<{ bankId: string; agencyId: string }> {
  const bank = await client.query(`INSERT INTO banks (name, slug) VALUES ($1,$1) RETURNING id`, [slug]);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  return { bankId, agencyId: (agency.rows[0] as { id: string }).id };
}

async function seedAgent(client: pg.Client, bankId: string, agencyId: string, email: string): Promise<string> {
  const u = await client.query(`INSERT INTO users (bank_id, email, role) VALUES ($1,$2,'AGENT') RETURNING id`, [bankId, email]);
  const id = (u.rows[0] as { id: string }).id;
  await client.query(`INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`, [bankId, agencyId, id]);
  return id;
}

async function insertFixtures(client: pg.Client): Promise<Fixtures> {
  const b1 = await seedBank(client, "bank1");
  const svc = await client.query(`INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'OC','O',10) RETURNING id`, [b1.bankId, b1.agencyId]);
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`, [b1.bankId, b1.agencyId, serviceId]);
  const queueId = (q.rows[0] as { id: string }).id;
  const agentId = await seedAgent(client, b1.bankId, b1.agencyId, "agent1@b1.ci");
  const otherAgentId = await seedAgent(client, b1.bankId, b1.agencyId, "agent2@b1.ci");
  const ctr = await client.query(`INSERT INTO counters (bank_id, agency_id, number, label, agent_id) VALUES ($1,$2,1,'G1',$3) RETURNING id`, [b1.bankId, b1.agencyId, agentId]);
  const counterId = (ctr.rows[0] as { id: string }).id;

  const b2 = await seedBank(client, "bank2");
  const otherBankAgentId = await seedAgent(client, b2.bankId, b2.agencyId, "agent@b2.ci");

  return {
    bankId: b1.bankId, agencyId: b1.agencyId, agentId, otherAgentId, serviceId, queueId, counterId,
    otherBankId: b2.bankId, otherBankAgencyId: b2.agencyId, otherBankAgentId,
  };
}

async function setStatus(agentId: string, status: string, bankId = fx.bankId, agencyId = fx.agencyId): Promise<void> {
  await db.query(`INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status) VALUES ($1,$2,$3,$4)`, [bankId, agencyId, agentId, status]);
}

/** Forge un JWT pour un rôle/scope donné. */
async function token(role: string, sub: string, bankId: string, agencyIds: string[]): Promise<string> {
  return new SignJWT({ role, bankId, agencyIds })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
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
  db = new pg.Client({ connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test` });
  await db.connect();
  redis = new Redis(`redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`);
  await runMigrations(db);
  fx = await insertFixtures(db);
  bus = createCaptureBus();
  app = createApp({ db, redis, jwtSecret: jwtSecretBytes, bus });
}, 180_000);

afterAll(async () => {
  await redis.quit();
  await db.end();
  await pgContainer.stop();
  await redisContainer.stop();
}, 30_000);

beforeEach(async () => {
  bus.events.length = 0;
  await redis.flushall();
  await db.query(`DELETE FROM tickets`);
  await db.query(`DELETE FROM agent_status_history`);
});

async function post(path: string, body: unknown, tok: string): Promise<{ status: number; data: unknown }> {
  const res = await app.fetch(new Request(`http://localhost/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function get(path: string, tok: string): Promise<{ status: number; data: unknown }> {
  const res = await app.fetch(new Request(`http://localhost/api/v1${path}`, {
    headers: { Authorization: `Bearer ${tok}` },
  }));
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

describe("API-007: POST /agents/:id/status — transitions + forçage SERVING + self", () => {
  it("API-007: transition légale AVAILABLE → PAUSED → 200 { status, previousStatus }", async () => {
    await setStatus(fx.agentId, "AVAILABLE");
    const tok = await token("AGENT", fx.agentId, fx.bankId, [fx.agencyId]);
    const r = await post(`/agents/${fx.agentId}/status`, { status: "PAUSED" }, tok);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ id: fx.agentId, status: "PAUSED", previousStatus: "AVAILABLE" });
  });

  it("API-007: transition illégale PAUSED → ABSENT → 409 ILLEGAL_AGENT_TRANSITION", async () => {
    await setStatus(fx.agentId, "PAUSED");
    const tok = await token("AGENT", fx.agentId, fx.bankId, [fx.agencyId]);
    const r = await post(`/agents/${fx.agentId}/status`, { status: "ABSENT" }, tok);
    expect(r.status).toBe(409);
    expect((r.data as { error: { code: string } }).error.code).toBe("ILLEGAL_AGENT_TRANSITION");
  });

  it("API-007: forçage manuel SERVING → 409 (piloté par le cycle ticket uniquement)", async () => {
    await setStatus(fx.agentId, "AVAILABLE");
    const tok = await token("AGENT", fx.agentId, fx.bankId, [fx.agencyId]);
    const r = await post(`/agents/${fx.agentId}/status`, { status: "SERVING" }, tok);
    expect(r.status).toBe(409);
    expect((r.data as { error: { code: string } }).error.code).toBe("ILLEGAL_AGENT_TRANSITION");
  });

  it("API-007: AGENT change le statut d'un AUTRE agent → 403 (self-only)", async () => {
    await setStatus(fx.otherAgentId, "AVAILABLE");
    const tok = await token("AGENT", fx.agentId, fx.bankId, [fx.agencyId]);
    const r = await post(`/agents/${fx.otherAgentId}/status`, { status: "PAUSED" }, tok);
    expect(r.status).toBe(403);
  });

  it("API-007: MANAGER change le statut d'un agent de son scope → 200", async () => {
    await setStatus(fx.agentId, "AVAILABLE");
    const tok = await token("MANAGER", "manager-1", fx.bankId, [fx.agencyId]);
    const r = await post(`/agents/${fx.agentId}/status`, { status: "OFFLINE" }, tok);
    expect(r.status).toBe(200);
  });
});

describe("API-007: serve/close pilotent SERVING/AVAILABLE via le cycle ticket (route réelle)", () => {
  it("API-007: /tickets/:id/serve → agent du guichet passe SERVING ; /close → AVAILABLE", async () => {
    await setStatus(fx.agentId, "AVAILABLE");
    const t = await db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, counter_id, number, status, called_at)
       VALUES ($1,$2,$3,$4,$5,1,'CALLED',NOW()) RETURNING id`,
      [fx.bankId, fx.agencyId, fx.queueId, fx.serviceId, fx.counterId]
    );
    const ticketId = (t.rows[0] as { id: string }).id;
    const tok = await token("AGENT", fx.agentId, fx.bankId, [fx.agencyId]);

    const served = await post(`/tickets/${ticketId}/serve`, {}, tok);
    expect(served.status).toBe(200);
    const afterServe = await db.query(`SELECT to_status FROM agent_status_history WHERE agent_id = $1 ORDER BY changed_at DESC LIMIT 1`, [fx.agentId]);
    expect((afterServe.rows[0] as { to_status: string }).to_status).toBe("SERVING");

    const closed = await post(`/tickets/${ticketId}/close`, {}, tok);
    expect(closed.status).toBe(200);
    const afterClose = await db.query(`SELECT to_status FROM agent_status_history WHERE agent_id = $1 ORDER BY changed_at DESC LIMIT 1`, [fx.agentId]);
    expect((afterClose.rows[0] as { to_status: string }).to_status).toBe("AVAILABLE");
  });
});

describe("API-007: stats self-only pour AGENT, scope pour MANAGER (tests RBAC)", () => {
  it("API-007: AGENT lit SES stats → 200 (self)", async () => {
    const tok = await token("AGENT", fx.agentId, fx.bankId, [fx.agencyId]);
    const r = await get(`/agents/${fx.agentId}/stats`, tok);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ agentId: fx.agentId, period: "day" });
  });

  it("API-007: AGENT tente de lire les stats d'un AUTRE agent → 403 (self-only)", async () => {
    const tok = await token("AGENT", fx.agentId, fx.bankId, [fx.agencyId]);
    const r = await get(`/agents/${fx.otherAgentId}/stats`, tok);
    expect(r.status).toBe(403);
  });

  it("API-007: MANAGER lit les stats de n'importe quel agent de son scope → 200", async () => {
    const tok = await token("MANAGER", "manager-1", fx.bankId, [fx.agencyId]);
    const r = await get(`/agents/${fx.agentId}/stats`, tok);
    expect(r.status).toBe(200);
  });

  it("API-007: période invalide → 400 VALIDATION_ERROR", async () => {
    const tok = await token("AGENT", fx.agentId, fx.bankId, [fx.agencyId]);
    const r = await get(`/agents/${fx.agentId}/stats?period=decade`, tok);
    expect(r.status).toBe(400);
    expect((r.data as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("API-007: période week explicitement demandée → 200 { period: week }", async () => {
    const tok = await token("AGENT", fx.agentId, fx.bankId, [fx.agencyId]);
    const r = await get(`/agents/${fx.agentId}/stats?period=week`, tok);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ period: "week" });
  });
});

describe("API-007: tenant-isolation — lecture/écriture statut+stats d'un agent hors scope → refus", () => {
  it("API-007: MANAGER de bank1 lit les stats d'un agent de bank2 → 404 (isolation tenant)", async () => {
    const tok = await token("MANAGER", "manager-1", fx.bankId, [fx.agencyId]);
    const r = await get(`/agents/${fx.otherBankAgentId}/stats`, tok);
    expect(r.status).toBe(404);
  });

  it("API-007: MANAGER de bank1 change le statut d'un agent de bank2 → 404 (isolation tenant)", async () => {
    await setStatus(fx.otherBankAgentId, "AVAILABLE", fx.otherBankId, fx.otherBankAgencyId);
    const tok = await token("MANAGER", "manager-1", fx.bankId, [fx.agencyId]);
    const r = await post(`/agents/${fx.otherBankAgentId}/status`, { status: "PAUSED" }, tok);
    expect(r.status).toBe(404);
  });

  it("API-007: GET /agents/:id profil d'un agent hors banque → 404", async () => {
    const tok = await token("MANAGER", "manager-1", fx.bankId, [fx.agencyId]);
    const r = await get(`/agents/${fx.otherBankAgentId}`, tok);
    expect(r.status).toBe(404);
  });

  it("API-007: GET /agents/:id profil d'un agent du scope → 200 (statut dérivé de l'historique)", async () => {
    await setStatus(fx.agentId, "AVAILABLE");
    const tok = await token("MANAGER", "manager-1", fx.bankId, [fx.agencyId]);
    const r = await get(`/agents/${fx.agentId}`, tok);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ id: fx.agentId, status: "AVAILABLE", role: "AGENT" });
  });

  it("API-007: profil avec workSchedule + statut par défaut OFFLINE (aucun historique)", async () => {
    await db.query(`UPDATE users SET work_schedule = $2 WHERE id = $1`, [
      fx.agentId,
      JSON.stringify({ monday: { start: "08:00", end: "17:00" } }),
    ]);
    const tok = await token("MANAGER", "manager-1", fx.bankId, [fx.agencyId]);
    const r = await get(`/agents/${fx.agentId}`, tok);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ status: "OFFLINE", languages: ["FR"] });
    expect((r.data as { workSchedule: unknown }).workSchedule).toBeDefined();
  });

  it("API-007: id de chemin malformé (non-UUID) → 404 (jamais 500)", async () => {
    const tok = await token("AGENT", fx.agentId, fx.bankId, [fx.agencyId]);
    const r = await get(`/agents/not-a-uuid/stats`, tok);
    expect(r.status).toBe(404);
  });

  it("API-007: corps de statut invalide (status inconnu) → 400 VALIDATION_ERROR", async () => {
    await setStatus(fx.agentId, "AVAILABLE");
    const tok = await token("AGENT", fx.agentId, fx.bankId, [fx.agencyId]);
    const r = await post(`/agents/${fx.agentId}/status`, { status: "BOGUS" }, tok);
    expect(r.status).toBe(400);
    expect((r.data as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });
});
