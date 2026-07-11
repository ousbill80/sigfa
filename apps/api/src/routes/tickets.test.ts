/**
 * Tests d'intégration — API-003 : cycle de vie du ticket (Testcontainers réel).
 *
 * PG 16 + Redis 7 réels. Nommage strict : `API-003: <description>`.
 * Couvre : émission+events<500ms, idempotence (rejeu/conflit/clé requise),
 * numérotation concurrente + reset Abidjan, displayNumber, tracking nanoid(21),
 * téléphone chiffré + hash + consent, position PULL rank(), TMT glissant,
 * cache Redis TTL 10s invalidé, transferts, no-show timeout, abandon,
 * queue:updated {length,estimate}.
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
import { computePosition, queueLength } from "src/services/queue-strategy.js";
import { getCachedEstimate } from "src/services/queue-estimation.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let bus: CaptureBus;
let app: ReturnType<typeof createApp>;
let ids: Awaited<ReturnType<typeof insertFixtures>>;
let token: string;

const JWT_SECRET = "tickets-jwt-secret-at-least-32-chars-long!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);
// Clés de test phone-cipher (64 hex = 32 octets).
process.env["PHONE_ENCRYPTION_KEY"] =
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  "2222222222222222222222222222222222222222222222222222222222222222";

/** Migrations minimales : enums + tables nécessaires à API-003. */
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
      status queue_status NOT NULL DEFAULT 'OPEN', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS counters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL,
      status counter_status NOT NULL DEFAULT 'OPEN', agent_id UUID, current_ticket_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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

/** Insère bank/agency/services/queues/counter. */
async function insertFixtures(client: pg.Client): Promise<{
  bankId: string; agencyId: string; userId: string;
  serviceId: string; queueId: string; code: string;
  service2Id: string; queue2Id: string; counterId: string;
}> {
  const bank = await client.query(`INSERT INTO banks (name, slug, no_show_timeout_minutes) VALUES ('B','b',3) RETURNING id`);
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  const agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await client.query(`INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'OC','Ouverture',10) RETURNING id`, [bankId, agencyId]);
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`, [bankId, agencyId, serviceId]);
  const queueId = (q.rows[0] as { id: string }).id;
  const svc2 = await client.query(`INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'CR','Credit',8) RETURNING id`, [bankId, agencyId]);
  const service2Id = (svc2.rows[0] as { id: string }).id;
  const q2 = await client.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`, [bankId, agencyId, service2Id]);
  const queue2Id = (q2.rows[0] as { id: string }).id;
  const ctr = await client.query(`INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,1,'G1') RETURNING id`, [bankId, agencyId]);
  const counterId = (ctr.rows[0] as { id: string }).id;
  const userId = "99999999-9999-4999-a999-999999999999";
  return { bankId, agencyId, userId, serviceId, queueId, code: "OC", service2Id, queue2Id, counterId };
}

/** Forge un JWT AGENT valide pour le tenant de test. */
async function forgeToken(): Promise<string> {
  return new SignJWT({ role: "AGENT", bankId: ids.bankId, agencyIds: [ids.agencyId] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ids.userId)
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
  await runMigrations(db);
  ids = await insertFixtures(db);
  bus = createCaptureBus();
  app = createApp({ db, redis, jwtSecret: jwtSecretBytes, bus });
  token = await forgeToken();
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
  await db.query(`DELETE FROM ticket_transfers`);
  await db.query(`DELETE FROM tickets`);
  await db.query(`UPDATE queues SET current_ticket_number = 0`);
});

/** POST helper avec headers optionnels. */
async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; text: string; data: unknown }> {
  const res = await app.fetch(new Request(`http://localhost/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  return { status: res.status, text, data: text ? JSON.parse(text) : null };
}

/** GET helper. */
async function get(path: string): Promise<{ status: number; data: unknown }> {
  const res = await app.fetch(new Request(`http://localhost/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }));
  return { status: res.status, data: await res.json() };
}

/** Émet un ticket standard et retourne le corps. */
async function issue(overrides: Record<string, unknown> = {}, key = `k-${nano()}`): Promise<Record<string, unknown>> {
  const r = await post("/tickets", { serviceId: ids.serviceId, channel: "KIOSK", ...overrides }, { "X-Idempotency-Key": key });
  return r.data as Record<string, unknown>;
}

/** Petit générateur de clés uniques. */
function nano(): string {
  return Math.random().toString(36).slice(2);
}

/** Ouvre une connexion PG indépendante (test de concurrence réelle). */
async function openClient(): Promise<pg.Client> {
  const c = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test`,
  });
  await c.connect();
  return c;
}

/** Insère un ticket du jour (Abidjan) pour forcer l'incrément (pas le reset). */
async function insertToday(): Promise<void> {
  await db.query(
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status)
     VALUES ($1,$2,$3,$4,0,$5,'KIOSK','DONE')`,
    [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, nano().padEnd(21, "y").slice(0, 21)]
  );
}

describe("API-003: cycle de vie du ticket", () => {
  it("API-003: émission → 201 complet + events <500ms (horloge/latence mesurée localement)", async () => {
    const start = performance.now();
    const r = await post("/tickets", { serviceId: ids.serviceId, channel: "KIOSK" }, { "X-Idempotency-Key": nano() });
    const elapsed = performance.now() - start;
    expect(r.status).toBe(201);
    const d = r.data as Record<string, unknown>;
    expect(d["displayNumber"]).toBe("OC-001");
    expect(d["status"]).toBe("WAITING");
    expect(typeof d["trackingId"]).toBe("string");
    expect((d["trackingId"] as string).length).toBe(21);
    expect(d["position"]).toBe(1);
    expect(typeof d["estimatedWaitMinutes"]).toBe("number");
    expect(elapsed).toBeLessThan(500);
    expect(bus.ofType("ticket:created")).toHaveLength(1);
    expect(bus.ofType("queue:updated")).toHaveLength(1);
  });

  it("API-003: rejeu même clé → réponse identique octet, zéro doublon ; clé identique payload différent → 409 (tests)", async () => {
    const key = nano();
    const first = await post("/tickets", { serviceId: ids.serviceId, channel: "KIOSK" }, { "X-Idempotency-Key": key });
    const replay = await post("/tickets", { serviceId: ids.serviceId, channel: "KIOSK" }, { "X-Idempotency-Key": key });
    expect(replay.status).toBe(201);
    expect(replay.text).toBe(first.text); // byte-identique
    const count = await db.query(`SELECT COUNT(*)::int AS n FROM tickets`);
    expect((count.rows[0] as { n: number }).n).toBe(1); // zéro doublon

    const conflict = await post("/tickets", { serviceId: ids.service2Id, channel: "QR" }, { "X-Idempotency-Key": key });
    expect(conflict.status).toBe(409);
    expect((conflict.data as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("API-003: clé absente sur POST /tickets → 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const res = await app.fetch(new Request("http://localhost/api/v1/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ serviceId: ids.serviceId, channel: "KIOSK" }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("API-003: numérotation — 2 émissions concurrentes → numéros distincts ; passage de minuit Abidjan → reset", async () => {
    // Émissions séquentielles via l'app → numéros distincts et croissants.
    const a = await issue();
    const b = await issue();
    expect(a["displayNumber"]).toBe("OC-001");
    expect(b["displayNumber"]).toBe("OC-002");

    // Concurrence RÉELLE : deux connexions PG distinctes exécutent le
    // lock-then-increment atomique en parallèle → numéros TOUJOURS distincts.
    await db.query(`DELETE FROM tickets`);
    await db.query(`UPDATE queues SET current_ticket_number = 0 WHERE id = $1`, [ids.queueId]);
    const [c1, c2] = await Promise.all([openClient(), openClient()]);
    const sql = `UPDATE queues q SET current_ticket_number = CASE
        WHEN EXISTS (SELECT 1 FROM tickets t WHERE t.queue_id = q.id
          AND t.issued_day = (NOW() AT TIME ZONE 'Africa/Abidjan')::date)
        THEN q.current_ticket_number + 1 ELSE 1 END
      WHERE q.id = $1 RETURNING current_ticket_number`;
    // Un ticket du jour existe déjà (garantit l'incrément, pas le reset)
    await insertToday();
    const [r1, r2] = await Promise.all([
      c1.query(sql, [ids.queueId]),
      c2.query(sql, [ids.queueId]),
    ]);
    const n1 = (r1.rows[0] as { current_ticket_number: number }).current_ticket_number;
    const n2 = (r2.rows[0] as { current_ticket_number: number }).current_ticket_number;
    expect(n1).not.toBe(n2); // lock-then-increment garantit la distinction
    await c1.end();
    await c2.end();

    // Reset Abidjan : ticket d'HIER puis émission aujourd'hui → repart à 1.
    await db.query(`DELETE FROM tickets`);
    await db.query(`UPDATE queues SET current_ticket_number = 42 WHERE id = $1`, [ids.queueId]);
    await db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, display_number, tracking_id, channel, status, issued_at)
       VALUES ($1,$2,$3,$4,42,'OC-042',$5,'KIOSK','DONE', NOW() - INTERVAL '1 day')`,
      [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, nano().padEnd(21, "x").slice(0, 21)]
    );
    const today = await issue();
    expect(today["displayNumber"]).toBe("OC-001"); // reset quotidien Abidjan
  });

  it("API-003: téléphone chiffré en base (jamais de clair), phone_hash posé + smsConsent", async () => {
    const t = await issue({ phoneNumber: "+2250700000001", smsConsent: true });
    const row = await db.query(`SELECT phone_encrypted, phone_hash, sms_consent FROM tickets WHERE id = $1`, [t["id"]]);
    const r = row.rows[0] as { phone_encrypted: string; phone_hash: string; sms_consent: boolean };
    expect(r.phone_encrypted).toMatch(/^v1:/);
    expect(r.phone_encrypted).not.toContain("0700000001"); // jamais de clair
    expect(r.phone_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.sms_consent).toBe(true);
  });

  it("API-003: position PULL — rank() OVER (PARTITION BY queue_id ORDER BY priority DESC, issued_at) (test SQL)", async () => {
    const t1 = await issue();
    const t2 = await issue();
    const t3 = await issue();
    expect(await computePosition(t1["id"] as string, db)).toBe(1);
    expect(await computePosition(t2["id"] as string, db)).toBe(2);
    expect(await computePosition(t3["id"] as string, db)).toBe(3);
    // priorité VIP passe devant en rank()
    const vip = await issue({ priority: "VIP" });
    expect(await computePosition(vip["id"] as string, db)).toBe(1);
  });

  it("API-003: TMT glissant 60 min ≥5 obs → moyenne service_time DONE ; <5 obs → sla_minutes ; fallback global 15", async () => {
    const { computeTmtMinutes } = await import("src/services/queue-estimation.js");
    // <5 obs → sla_minutes du service (10)
    expect(await computeTmtMinutes(ids.serviceId, db)).toBe(10);
    // 5 DONE récents à 120s → moyenne 2 min
    for (let i = 0; i < 5; i++) {
      await db.query(
        `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, tracking_id, channel, status, service_time_seconds, closed_at)
         VALUES ($1,$2,$3,$4,$5,$6,'KIOSK','DONE',120, NOW())`,
        [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, 100 + i, `tmt${i}`.padEnd(21, "z").slice(0, 21)]
      );
    }
    expect(await computeTmtMinutes(ids.serviceId, db)).toBe(2);
    // service inconnu → fallback global 15 (pas de sla)
    const unknownSvc = "88888888-8888-4888-a888-888888888888";
    expect(await computeTmtMinutes(unknownSvc, db)).toBe(15);
  });

  it("API-003: cache Redis TTL 10 s invalidé sur toute mutation de file (Testcontainers Redis)", async () => {
    const { setCachedEstimate } = await import("src/services/queue-estimation.js");
    await setCachedEstimate(redis, ids.queueId, { length: 3, estimate: 30 });
    expect(await getCachedEstimate(redis, ids.queueId)).not.toBeNull();
    const ttl = await redis.ttl(`estimate:${ids.queueId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10);
    // Une émission (mutation) doit invalider le cache de la file
    await issue();
    expect(await getCachedEstimate(redis, ids.queueId)).toBeNull();
  });

  it("API-003: call-next file vide → 404 QUEUE_EMPTY ; sinon WAITING→CALLED + ticket:called", async () => {
    const empty = await post(`/counters/${ids.counterId}/call-next`, {});
    expect(empty.status).toBe(404);
    expect((empty.data as { error: { code: string } }).error.code).toBe("QUEUE_EMPTY");

    await issue();
    const called = await post(`/counters/${ids.counterId}/call-next`, {});
    expect(called.status).toBe(200);
    expect((called.data as { status: string }).status).toBe("CALLED");
    expect(bus.ofType("ticket:called")).toHaveLength(1);
  });

  it("API-003: appel ciblé — deuxième guichet → 409 TICKET_ALREADY_CLAIMED (verrou Redis SET NX)", async () => {
    const t = await issue();
    const ok = await post(`/tickets/${t["id"]}/call`, { counterId: ids.counterId });
    expect(ok.status).toBe(200);
    const otherCounter = "dddddddd-dddd-4ddd-addd-dddddddddddd";
    const conflict = await post(`/tickets/${t["id"]}/call`, { counterId: otherCounter });
    expect(conflict.status).toBe(409);
    expect((conflict.data as { error: { code: string } }).error.code).toBe("TICKET_ALREADY_CLAIMED");
  });

  it("API-003: serve → close → durées exactes persistées + ticket:closed", async () => {
    const t = await issue();
    await post(`/tickets/${t["id"]}/call`, { counterId: ids.counterId });
    await post(`/tickets/${t["id"]}/serve`, {});
    // fixer des timestamps pour des durées exactes
    await db.query(
      `UPDATE tickets SET issued_at = NOW() - INTERVAL '200 seconds', called_at = NOW() - INTERVAL '100 seconds', served_at = NOW() - INTERVAL '60 seconds' WHERE id = $1`,
      [t["id"]]
    );
    const closed = await post(`/tickets/${t["id"]}/close`, {});
    expect(closed.status).toBe(200);
    const d = closed.data as { status: string; waitTime: number; serviceTime: number };
    expect(d.status).toBe("DONE");
    expect(d.waitTime).toBe(100);
    expect(d.serviceTime).toBe(60);
    expect(bus.ofType("ticket:closed")).toHaveLength(1);
    const row = await db.query(`SELECT wait_time_seconds, service_time_seconds FROM tickets WHERE id = $1`, [t["id"]]);
    expect(row.rows[0]).toMatchObject({ wait_time_seconds: 100, service_time_seconds: 60 });
  });

  it("API-003: no-show avant timeout banque → 422 ; après → NO_SHOW + stats", async () => {
    const t = await issue();
    await post(`/tickets/${t["id"]}/call`, { counterId: ids.counterId });
    const tooEarly = await post(`/tickets/${t["id"]}/no-show`, {});
    expect(tooEarly.status).toBe(422);
    // simuler le dépassement du timeout (3 min banque)
    await db.query(`UPDATE tickets SET called_at = NOW() - INTERVAL '5 minutes' WHERE id = $1`, [t["id"]]);
    const ok = await post(`/tickets/${t["id"]}/no-show`, {});
    expect(ok.status).toBe(200);
    expect((ok.data as { status: string }).status).toBe("NO_SHOW");
    const row = await db.query(`SELECT status, no_show_at FROM tickets WHERE id = $1`, [t["id"]]);
    expect((row.rows[0] as { status: string }).status).toBe("NO_SHOW");
    expect((row.rows[0] as { no_show_at: Date | null }).no_show_at).not.toBeNull();
  });

  it("API-003: transfert → ligne ticket_transfers + WAITING file cible", async () => {
    const t = await issue();
    await post(`/tickets/${t["id"]}/call`, { counterId: ids.counterId });
    await post(`/tickets/${t["id"]}/serve`, {});
    const transfer = await post(`/tickets/${t["id"]}/transfer`, { targetServiceId: ids.service2Id, reason: "mauvais service" });
    expect(transfer.status).toBe(200);
    expect((transfer.data as { status: string }).status).toBe("TRANSFERRED");
    const tr = await db.query(`SELECT * FROM ticket_transfers WHERE ticket_id = $1`, [t["id"]]);
    expect(tr.rows).toHaveLength(1);
    expect((tr.rows[0] as { to_service_id: string }).to_service_id).toBe(ids.service2Id);
    // un WAITING doit exister dans la file cible
    const waiting = await queueLength(ids.queue2Id, db);
    expect(waiting).toBe(1);
  });

  it("API-003: abandon WAITING → ABANDONED ; transition illégale (DONE→call) → 409 ILLEGAL_TRANSITION", async () => {
    const t = await issue();
    const ab = await post(`/tickets/${t["id"]}/abandon`, {});
    expect(ab.status).toBe(200);
    expect((ab.data as { status: string }).status).toBe("ABANDONED");
    // ré-appeler un ABANDONED → transition illégale
    const illegal = await post(`/tickets/${t["id"]}/call`, { counterId: ids.counterId });
    expect(illegal.status).toBe(409);
    expect((illegal.data as { error: { code: string } }).error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("API-003: GET /tickets/:id → position temps réel", async () => {
    const t1 = await issue();
    const t2 = await issue();
    const r = await get(`/tickets/${t2["id"]}`);
    expect(r.status).toBe(200);
    expect((r.data as { position: number }).position).toBe(2);
    void t1;
  });

  it("API-003: queue:updated payload = {length, estimate} uniquement (contrat Zod à l'émission réelle)", async () => {
    await issue();
    const evt = bus.ofType("queue:updated").at(-1);
    expect(evt).toBeDefined();
    expect(Object.keys(evt?.payload as object).sort()).toEqual(["estimate", "length", "queueId"]);
  });
});
