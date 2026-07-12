/**
 * Tests d'intégration — API-004 : moteur de file (Testcontainers réel).
 *
 * PG 16 + Redis 7 réels. Nommage strict : `API-004: <description>`.
 * Couvre :
 * - Ordre VIP>PMR>SENIOR>PRIORITY>STANDARD puis FIFO (critère 1)
 * - Routage langue soft-timeout (critère 2)
 * - Débordement + alerte QUEUE_CRITICAL one-shot (critère 3)
 * - Pause de file → 422, call-next OK sur restants, réouverture (critère 4)
 * - Position/estimation reflète les priorités (critère 5)
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
import { computePositionPriority } from "src/services/queue-engine.js";
import { shouldAlertOverflow } from "src/services/queue-engine.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let bus: CaptureBus;
let app: ReturnType<typeof createApp>;
let ids: Awaited<ReturnType<typeof insertFixtures>>;
let token: string;
let managerToken: string;

const JWT_SECRET = "queue-engine-jwt-secret-at-least-32-chars!!";
const jwtSecretBytes = new TextEncoder().encode(JWT_SECRET);
process.env["PHONE_ENCRYPTION_KEY"] =
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  "2222222222222222222222222222222222222222222222222222222222222222";

/** Migrations minimales + colonnes API-004. */
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
      queue_critical_threshold INTEGER,
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
    CREATE TABLE IF NOT EXISTS operations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id),
      code VARCHAR(6) NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER,
      display_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, icon_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(service_id, code));
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS queues (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), service_id UUID NOT NULL REFERENCES services(id),
      current_ticket_number INTEGER NOT NULL DEFAULT 0, is_open BOOLEAN NOT NULL DEFAULT true,
      status queue_status NOT NULL DEFAULT 'OPEN',
      open_at TEXT, close_at TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS counters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), number INTEGER NOT NULL, label TEXT NOT NULL,
      status counter_status NOT NULL DEFAULT 'OPEN', agent_id UUID, current_ticket_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID REFERENCES banks(id),
      email TEXT NOT NULL UNIQUE,
      languages TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS counter_services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      counter_id UUID NOT NULL REFERENCES counters(id),
      service_id UUID NOT NULL REFERENCES services(id),
      UNIQUE(counter_id, service_id));
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id), queue_id UUID NOT NULL REFERENCES queues(id),
      service_id UUID NOT NULL REFERENCES services(id), operation_id UUID REFERENCES operations(id), counter_id UUID, agent_id UUID,
      number INTEGER NOT NULL, display_number TEXT, tracking_id CHAR(21) NOT NULL UNIQUE,
      channel ticket_channel NOT NULL, status ticket_status NOT NULL DEFAULT 'WAITING',
      priority ticket_priority NOT NULL DEFAULT 'STANDARD', phone_encrypted TEXT, phone_hash TEXT,
      sms_consent BOOLEAN NOT NULL DEFAULT false,
      required_language TEXT,
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

/** Insère bank/agency/services/queues/counters/users. */
async function insertFixtures(client: pg.Client) {
  const bank = await client.query(
    `INSERT INTO banks (name, slug, no_show_timeout_minutes, queue_critical_threshold)
     VALUES ('B','b',3,5) RETURNING id`
  );
  const bankId = (bank.rows[0] as { id: string }).id;
  const agency = await client.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]
  );
  const agencyId = (agency.rows[0] as { id: string }).id;

  // Service 1 : OC
  const svc = await client.query(
    `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'OC','Ouverture',10) RETURNING id`,
    [bankId, agencyId]
  );
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await client.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
    [bankId, agencyId, serviceId]
  );
  const queueId = (q.rows[0] as { id: string }).id;

  // Service 2 : CR (pour débordement/transfert)
  const svc2 = await client.query(
    `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'CR','Credit',8) RETURNING id`,
    [bankId, agencyId]
  );
  const service2Id = (svc2.rows[0] as { id: string }).id;
  const q2 = await client.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
    [bankId, agencyId, service2Id]
  );
  const queue2Id = (q2.rows[0] as { id: string }).id;

  // Counter 1 : lié aux 2 services (pour débordement compatible)
  const ctr = await client.query(
    `INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,1,'G1') RETURNING id`,
    [bankId, agencyId]
  );
  const counterId = (ctr.rows[0] as { id: string }).id;

  // Lier guichet aux 2 services via counter_services
  await client.query(
    `INSERT INTO counter_services (counter_id, service_id) VALUES ($1,$2),($1,$3)`,
    [counterId, serviceId, service2Id]
  );

  // Agent FR (parle français)
  const userId = "99999999-9999-4999-a999-999999999999";
  await client.query(
    `INSERT INTO users (id, bank_id, email, languages) VALUES ($1,$2,'agent@test.com',ARRAY['FR'])`,
    [userId, bankId]
  );
  // Lier agent au guichet
  await client.query(
    `UPDATE counters SET agent_id = $1 WHERE id = $2`, [userId, counterId]
  );

  return {
    bankId, agencyId, userId, serviceId, queueId,
    service2Id, queue2Id, counterId,
  };
}

/** Forge un JWT AGENT valide. */
async function forgeToken(role = "AGENT"): Promise<string> {
  return new SignJWT({ role, bankId: ids.bankId, agencyIds: [ids.agencyId] })
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
  token = await forgeToken("AGENT");
  managerToken = await forgeToken("MANAGER");
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
  await db.query(`UPDATE queues SET current_ticket_number = 0, status = 'OPEN', is_open = true`);
  await db.query(`UPDATE banks SET queue_critical_threshold = 5`);
});

/** POST helper. */
async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  tok = token
): Promise<{ status: number; data: unknown }> {
  const res = await app.fetch(new Request(`http://localhost/api/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tok}`,
      ...headers,
    },
    body: JSON.stringify(body),
  }));
  return { status: res.status, data: await res.json() };
}

/** PATCH helper. */
async function patch(
  path: string,
  body: unknown,
  tok = managerToken
): Promise<{ status: number; data: unknown }> {
  const res = await app.fetch(new Request(`http://localhost/api/v1${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tok}`,
    },
    body: JSON.stringify(body),
  }));
  return { status: res.status, data: await res.json() };
}

/** Émet un ticket et retourne le corps. */
function nano(): string {
  return Math.random().toString(36).slice(2);
}

async function issue(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const r = await post(
    "/tickets",
    { serviceId: ids.serviceId, channel: "KIOSK", ...overrides },
    { "X-Idempotency-Key": nano() }
  );
  return r.data as Record<string, unknown>;
}

// ── Critère 1 : ordre VIP>PMR>SENIOR>PRIORITY>STANDARD puis FIFO ─────────────

describe("API-004: ordre VIP>PMR>SENIOR>PRIORITY>STANDARD puis FIFO — intégration", () => {
  it("API-004: VIP émis après STANDARD est servi en premier (call-next prioritaire)", async () => {
    const std = await issue({ priority: "STANDARD" });
    const vip = await issue({ priority: "VIP" });

    const called = await post(`/counters/${ids.counterId}/call-next`, {});
    expect(called.status).toBe(200);
    // Le VIP doit être appelé en premier même s'il a été émis après
    expect((called.data as { id: string }).id).toBe(vip.id as string);
    void std;
  });

  it("API-004: FIFO à priorité égale — standard le plus ancien est servi en premier", async () => {
    const first = await issue({ priority: "STANDARD" });
    const second = await issue({ priority: "STANDARD" });

    const called = await post(`/counters/${ids.counterId}/call-next`, {});
    expect(called.status).toBe(200);
    expect((called.data as { id: string }).id).toBe(first.id as string);
    void second;
  });

  it("API-004: PMR passe avant SENIOR, SENIOR avant PRIORITY, PRIORITY avant STANDARD", async () => {
    const std = await issue({ priority: "STANDARD" });
    const prio = await issue({ priority: "PRIORITY" });
    const senior = await issue({ priority: "SENIOR" });
    const pmr = await issue({ priority: "PMR" });

    // Appel 1 → PMR
    const c1 = await post(`/counters/${ids.counterId}/call-next`, {});
    expect((c1.data as { id: string }).id).toBe(pmr.id as string);
    // Appel 2 → SENIOR
    const c2 = await post(`/counters/${ids.counterId}/call-next`, {});
    expect((c2.data as { id: string }).id).toBe(senior.id as string);
    // Appel 3 → PRIORITY
    const c3 = await post(`/counters/${ids.counterId}/call-next`, {});
    expect((c3.data as { id: string }).id).toBe(prio.id as string);
    // Appel 4 → STANDARD
    const c4 = await post(`/counters/${ids.counterId}/call-next`, {});
    expect((c4.data as { id: string }).id).toBe(std.id as string);
  });
});

// ── Critère 2 : langue (soft timeout avec horloge réelle) ────────────────────

describe("API-004: langue non parlée → sauté pour ce guichet, soft timeout → pris quand même", () => {
  it("API-004: ticket sans langue requise — agent FR → ticket sélectionné normalement", async () => {
    const t = await issue(); // sans requiredLanguage
    const called = await post(`/counters/${ids.counterId}/call-next`, {});
    expect(called.status).toBe(200);
    expect((called.data as { id: string }).id).toBe(t.id as string);
  });

  it("API-004: ticket FR requis — agent FR → sélectionné", async () => {
    const t = await issue({ requiredLanguage: "FR" });
    const called = await post(`/counters/${ids.counterId}/call-next`, {});
    expect(called.status).toBe(200);
    expect((called.data as { id: string }).id).toBe(t.id as string);
  });

  it("API-004: ticket EN requis récent — agent FR → sauté (file vide pour cet agent)", async () => {
    // Émet un ticket EN avec issued_at récent (bien dans le soft-timeout)
    await issue({ requiredLanguage: "EN" });
    // L'agent FR ne parle pas EN et le ticket est trop récent → file vide pour lui
    const called = await post(`/counters/${ids.counterId}/call-next`, {});
    expect(called.status).toBe(404);
    expect((called.data as { error: { code: string } }).error.code).toBe("QUEUE_EMPTY");
  });

  it("API-004: ticket EN requis vieux (soft-timeout dépassé) → pris par l'agent FR", async () => {
    // Insère directement un ticket avec issued_at dans le passé (>LANGUAGE_SOFT_TIMEOUT_MINUTES)
    // display_number obligatoire pour le payload ticket:called (validation Zod bus)
    await db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, display_number,
        tracking_id, channel, status, priority, required_language, issued_at)
       VALUES ($1,$2,$3,$4,999,'OC-999',$5,'KIOSK','WAITING','STANDARD','EN',
               NOW() - INTERVAL '15 minutes')`,
      [ids.bankId, ids.agencyId, ids.queueId, ids.serviceId, nano().padEnd(21, "z").slice(0, 21)]
    );
    const called = await post(`/counters/${ids.counterId}/call-next`, {});
    // Soft-timeout dépassé → le ticket est pris même par un agent FR
    expect(called.status).toBe(200);
  });
});

// ── Critère 3 : débordement + alerte QUEUE_CRITICAL one-shot ─────────────────

describe("API-004: seuil franchi → débordement actif + UNE alerte QUEUE_CRITICAL ; redescente puis re-franchissement → nouvelle alerte", () => {
  it("API-004: shouldAlertOverflow intégration — premier franchissement PG+Redis → alert émise", async () => {
    // On set threshold à 5 et on insère 6 tickets WAITING
    for (let i = 0; i < 6; i++) {
      await issue();
    }
    // Vérifier shouldAlertOverflow directement
    const doAlert = await shouldAlertOverflow(ids.queueId, 6, ids.bankId, db, redis);
    expect(doAlert).toBe(true);
    // Deuxième appel → flag déjà posé → false
    const noAlert = await shouldAlertOverflow(ids.queueId, 6, ids.bankId, db, redis);
    expect(noAlert).toBe(false);
  });

  it("API-004: call-next après dépassement seuil → alert:manager QUEUE_CRITICAL émise dans le bus", async () => {
    // Seuil = 5, on émet 7 tickets → après call-next il en reste 6 > 5 → alerte
    for (let i = 0; i < 7; i++) {
      await issue();
    }
    bus.events.length = 0; // reset les events

    // call-next → file passe de 7 à 6 WAITING (> seuil 5) → alerte
    await post(`/counters/${ids.counterId}/call-next`, {});
    const alerts = bus.ofType("alert:manager");
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    // API-007 : forme contractuelle unique `{ type, payload }` (union supprimée).
    const alert = alerts[0]?.payload as { type: string; payload: { queueId: string } };
    expect(alert.type).toBe("QUEUE_CRITICAL");
    expect(alert.payload.queueId).toBe(ids.queueId);
  });

  it("API-004: deuxième call-next sans redescente → PAS de deuxième alerte (pas de rafale)", async () => {
    // Seuil = 5, émet 7 tickets → après 1er call-next: 6 > 5 → alerte
    for (let i = 0; i < 7; i++) {
      await issue();
    }
    // Premier appel → alerte
    await post(`/counters/${ids.counterId}/call-next`, {});
    const alertsAfterFirst = bus.ofType("alert:manager").length;

    bus.events.length = 0;
    // Deuxième appel (file passe de 6 à 5 → 5 n'est pas > 5 donc pas d'alerte)
    // Restons au-dessus du seuil : émettons encore 2 tickets (file = 7)
    await issue();
    await issue();
    // File est maintenant 7 mais flag déjà posé → pas d'alerte
    await post(`/counters/${ids.counterId}/call-next`, {});
    const alertsAfterSecond = bus.ofType("alert:manager").length;
    expect(alertsAfterFirst).toBeGreaterThanOrEqual(1);
    expect(alertsAfterSecond).toBe(0);
  });

  it("API-004: redescente sous seuil puis re-franchissement → nouvelle alerte (flag reset)", async () => {
    // Émet 6 tickets
    for (let i = 0; i < 6; i++) {
      await issue();
    }
    // Premier franchissement
    const doAlert1 = await shouldAlertOverflow(ids.queueId, 6, ids.bankId, db, redis);
    expect(doAlert1).toBe(true);

    // Redescente : passage à 4 (sous seuil 5) → reset flag
    const noAlert = await shouldAlertOverflow(ids.queueId, 4, ids.bankId, db, redis);
    expect(noAlert).toBe(false);
    expect(await redis.get(`overflow_alerted:${ids.queueId}`)).toBeNull();

    // Re-franchissement → nouvelle alerte
    const doAlert2 = await shouldAlertOverflow(ids.queueId, 7, ids.bankId, db, redis);
    expect(doAlert2).toBe(true);
  });
});

// ── Critère 4 : pause de file ─────────────────────────────────────────────────

describe("API-004: file en pause → émission 422, call-next des tickets restants OK, réouverture OK", () => {
  it("API-004: PATCH /queues/:id PAUSED → file en pause", async () => {
    const r = await patch(`/queues/${ids.queueId}`, { status: "PAUSED" });
    expect(r.status).toBe(200);
    expect((r.data as { status: string }).status).toBe("PAUSED");
    // Vérifier en base
    const row = await db.query(`SELECT status FROM queues WHERE id = $1`, [ids.queueId]);
    expect((row.rows[0] as { status: string }).status).toBe("PAUSED");
  });

  it("API-004: file fermée (PAUSED) → émission 422 QUEUE_PAUSED", async () => {
    await patch(`/queues/${ids.queueId}`, { status: "PAUSED" });
    const r = await post("/tickets", { serviceId: ids.serviceId, channel: "KIOSK" }, { "X-Idempotency-Key": nano() });
    expect(r.status).toBe(422);
    expect((r.data as { error: { code: string } }).error.code).toBe("QUEUE_PAUSED");
  });

  it("API-004: file fermée (PAUSED) — tickets existants servables via call-next", async () => {
    // Émet 2 tickets AVANT la fermeture
    const t1 = await issue();
    const t2 = await issue();
    // Ferme la file
    await patch(`/queues/${ids.queueId}`, { status: "PAUSED" });
    // call-next doit fonctionner sur les tickets déjà en attente
    const c1 = await post(`/counters/${ids.counterId}/call-next`, {});
    expect(c1.status).toBe(200);
    const c2 = await post(`/counters/${ids.counterId}/call-next`, {});
    expect(c2.status).toBe(200);
    // File vide → 404
    const empty = await post(`/counters/${ids.counterId}/call-next`, {});
    expect(empty.status).toBe(404);
    void t1; void t2;
  });

  it("API-004: réouverture OPEN → émission possible à nouveau", async () => {
    await patch(`/queues/${ids.queueId}`, { status: "PAUSED" });
    // Vérification que c'est bien fermé
    const blocked = await post("/tickets", { serviceId: ids.serviceId, channel: "KIOSK" }, { "X-Idempotency-Key": nano() });
    expect(blocked.status).toBe(422);
    // Réouverture
    const reopened = await patch(`/queues/${ids.queueId}`, { status: "OPEN" });
    expect(reopened.status).toBe(200);
    // Émission à nouveau possible
    const t = await issue();
    expect(t.status).toBe("WAITING");
  });

  it("API-004: PATCH /queues/:id avec plages horaires → openAt/closeAt persistés", async () => {
    const r = await patch(`/queues/${ids.queueId}`, {
      status: "OPEN",
      openAt: "08:00",
      closeAt: "17:00",
    });
    expect(r.status).toBe(200);
    expect((r.data as { openAt: string }).openAt).toBe("08:00");
    expect((r.data as { closeAt: string }).closeAt).toBe("17:00");
  });
});

// ── Critère 5 : position/estimation reflètent les priorités ──────────────────

describe("API-004: position/estimation reflètent les priorités (un VIP émis après passe devant — position recalculée)", () => {
  it("API-004: VIP émis après STANDARD — position du VIP = 1, STANDARD passe en position 2", async () => {
    const std = await issue({ priority: "STANDARD" });
    const vip = await issue({ priority: "VIP" });

    // Position du VIP dans la file = 1 (passe devant)
    const posVip = await computePositionPriority(vip.id as string, db);
    expect(posVip).toBe(1);
    // Position du STANDARD = 2 (relégué derrière)
    const posStd = await computePositionPriority(std.id as string, db);
    expect(posStd).toBe(2);
  });

  it("API-004: GET /tickets/:id position reflète les priorités (VIP position 1)", async () => {
    await issue({ priority: "STANDARD" });
    const vip = await issue({ priority: "VIP" });

    const res = await app.fetch(new Request(`http://localhost/api/v1/tickets/${vip.id as string}`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
    const data = await res.json() as { position: number };
    expect(res.status).toBe(200);
    expect(data.position).toBe(1);
  });

  it("API-004: position 201 inclut la position prioritaire lors de l'émission d'un VIP", async () => {
    await issue({ priority: "STANDARD" });
    await issue({ priority: "PRIORITY" });
    const vip = await issue({ priority: "VIP" });
    // Le VIP est émis en 3e mais doit avoir position=1
    expect(vip.position).toBe(1);
  });
});
