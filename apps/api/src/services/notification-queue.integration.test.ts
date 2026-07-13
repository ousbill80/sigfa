/**
 * Tests d'intégration — NOTIF-001 : infrastructure BullMQ de notification
 * (Testcontainers PG16 + Redis 7 réels). Prouve le cycle de vie complet :
 *  - 4 files de canal + 1 DLQ instanciées avec prefix d'environnement ;
 *  - jobId = dedupe_key → double enfilement = UN seul job, UN seul SENT ;
 *  - échec transitoire → retry backoff (borné) → épuisement → DLQ + log FAILED ;
 *  - rejeu DLQ avec même dedupe_key → zéro doublon SENT/DELIVERED ;
 *  - garde tenant D5 : un job d'une banque ne lit/écrit JAMAIS le log d'une autre ;
 *  - getQueueHealth() : compteurs par file + DLQ.
 *
 * Déterminisme : le backoff est configuré base/cap minuscules via env (l'intervalle
 * borné exact est prouvé unitairement dans `notification-jobs.test.ts`), donc pas
 * de sleep réel de 5 s. Aucun appel fournisseur : `send` est une fonction injectée.
 *
 * Nommage strict : `NOTIF-001: <description>`.
 *
 * @module
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { Queue } from "bullmq";
import {
  startNotificationInfra,
  channelQueueName,
  DLQ_NAME,
  NOTIFICATION_CHANNELS,
  type DlqJobData,
  type NotificationInfra,
} from "src/services/notification-queue.js";
import {
  notificationDedupeKey,
  NotificationSendError,
  type NotificationJobData,
  type QueryFn,
  type SendFn,
} from "src/services/notification-jobs.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let connection: { host: string; port: number };
let infra: NotificationInfra | undefined;
let ids: { bankA: string; bankB: string };

const PREFIX = "sigfa-notif-test";

/** Adaptateur QueryFn au-dessus du client pg réel. */
const queryFn: QueryFn = async (sql: string) => {
  const res = await db.query(sql);
  return { rows: res.rows as Record<string, unknown>[] };
};

async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='notification_status') THEN
        CREATE TYPE notification_status AS ENUM ('QUEUED','SENT','DELIVERED','FAILED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='notification_channel') THEN
        CREATE TYPE notification_channel AS ENUM ('SMS','WHATSAPP','EMAIL','PUSH'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='notification_type') THEN
        CREATE TYPE notification_type AS ENUM ('TICKET_CONFIRMATION','POSITION_UPDATE','YOUR_TURN','DAILY_REPORT'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='notification_failure_reason') THEN
        CREATE TYPE notification_failure_reason AS ENUM ('PROVIDER_UNREACHABLE','INVALID_NUMBER','OPT_OUT','TEMPLATE_REJECTED','QUOTA_EXCEEDED','UNKNOWN'); END IF;
    END $$;
  `);
  await client.query(
    `CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);`
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS notification_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      ticket_id UUID,
      type notification_type NOT NULL,
      channel notification_channel NOT NULL,
      phone_hash TEXT,
      device_id UUID,
      status notification_status NOT NULL DEFAULT 'QUEUED',
      failure_reason notification_failure_reason,
      provider_message_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ
    );
  `);
  // RLS applicative : garantit qu'un tenant ne voit jamais le log d'un autre (D5).
  await client.query(`ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;`);
  await client.query(`ALTER TABLE notification_log FORCE ROW LEVEL SECURITY;`);
  await client.query(`DROP POLICY IF EXISTS tenant_isolation ON notification_log;`);
  await client.query(`
    CREATE POLICY tenant_isolation ON notification_log
      USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
      WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
  `);
}

/** Crée une ligne notification_log en QUEUED (sous le tenant fourni) et renvoie son id. */
async function insertQueuedLog(
  bankId: string,
  channel: string
): Promise<string> {
  const res = await db.query(
    `INSERT INTO notification_log (bank_id, type, channel, phone_hash, status)
     VALUES ($1, 'TICKET_CONFIRMATION', $2::notification_channel, 'ph', 'QUEUED')
     RETURNING id`,
    [bankId, channel]
  );
  return (res.rows[0] as { id: string }).id;
}

function jobFor(bankId: string, logId: string): NotificationJobData {
  const dedupeKey = notificationDedupeKey({
    bankId,
    ticketId: logId,
    type: "TICKET_CONFIRMATION",
    channel: "SMS",
    phoneHash: "ph",
  });
  return {
    bankId,
    dedupeKey,
    logId,
    ticketId: null,
    type: "TICKET_CONFIRMATION",
    channel: "SMS",
  };
}

async function statusOf(logId: string): Promise<{ status: string; failure_reason: string | null }> {
  const res = await db.query(
    `SELECT status, failure_reason FROM notification_log WHERE id = $1`,
    [logId]
  );
  return res.rows[0] as { status: string; failure_reason: string | null };
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor: condition non satisfaite avant le timeout");
}

beforeAll(async () => {
  pgContainer = await new GenericContainer("postgres:16")
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
  redisContainer = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  db = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test`,
  });
  await db.connect();
  connection = {
    host: redisContainer.getHost(),
    port: redisContainer.getMappedPort(6379),
  };
  redis = new Redis({ ...connection, maxRetriesPerRequest: null });
  await runMigrations(db);
  const a = await db.query(
    `INSERT INTO banks (name, slug) VALUES ('A','a') RETURNING id`
  );
  const b = await db.query(
    `INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`
  );
  ids = {
    bankA: (a.rows[0] as { id: string }).id,
    bankB: (b.rows[0] as { id: string }).id,
  };
  // Backoff minuscule pour un DLQ rapide et déterministe (l'intervalle borné exact
  // est prouvé unitairement). Prefix d'environnement dédié.
  process.env["NOTIF_BACKOFF_BASE_MS"] = "10";
  process.env["NOTIF_BACKOFF_CAP_MS"] = "20";
  process.env["NOTIF_MAX_ATTEMPTS"] = "3";
  process.env["NOTIF_CHANNEL_CONCURRENCY"] = "2";
  process.env["NOTIF_QUEUE_PREFIX"] = PREFIX;
}, 180_000);

afterAll(async () => {
  await redis?.quit();
  await db?.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
}, 40_000);

beforeEach(async () => {
  await db.query(`DELETE FROM notification_log`);
  await redis.flushall();
});

afterEach(async () => {
  await infra?.close();
  infra = undefined;
});

describe("NOTIF-001 files de canal + DLQ", () => {
  it("NOTIF-001: 4 files canal + 1 DLQ instanciées avec prefix d'environnement", async () => {
    const okSend: SendFn = async () => ({ providerMessageId: "mid" });
    infra = startNotificationInfra({ connection, queryFn, send: okSend });

    expect([...infra.queues.keys()].sort()).toEqual(
      [...NOTIFICATION_CHANNELS].sort()
    );
    for (const ch of NOTIFICATION_CHANNELS) {
      expect(infra.queues.get(ch)?.name).toBe(channelQueueName(ch));
      expect(infra.queues.get(ch)?.opts.prefix).toBe(PREFIX);
    }
    expect(infra.dlq.name).toBe(DLQ_NAME);
    expect(infra.dlq.opts.prefix).toBe(PREFIX);
  });
});

describe("NOTIF-001 idempotence d'envoi (jobId = dedupe_key)", () => {
  it("NOTIF-001: double enfilement du même envoi = UN seul job, UN seul SENT", async () => {
    let sends = 0;
    const okSend: SendFn = async () => {
      sends += 1;
      return { providerMessageId: `mid-${sends}` };
    };
    infra = startNotificationInfra({ connection, queryFn, send: okSend });

    const logId = await insertQueuedLog(ids.bankA, "SMS");
    const job = jobFor(ids.bankA, logId);

    const j1 = await infra.enqueue(job);
    const j2 = await infra.enqueue(job); // même dedupeKey ⇒ même job
    expect(j2.id).toBe(j1.id);

    await waitFor(async () => (await statusOf(logId)).status === "SENT");
    // BullMQ a dédupliqué l'enfilement (jobId identique) ⇒ un seul envoi.
    expect(sends).toBe(1);
    expect((await statusOf(logId)).status).toBe("SENT");
  });
});

describe("NOTIF-001 retry + dead-letter", () => {
  it("NOTIF-001: échec transitoire → épuisement → DLQ (payload+failure_reason), log FAILED", async () => {
    const failSend: SendFn = async () => {
      throw new NotificationSendError("PROVIDER_UNREACHABLE");
    };
    infra = startNotificationInfra({ connection, queryFn, send: failSend });

    const logId = await insertQueuedLog(ids.bankA, "SMS");
    const job = jobFor(ids.bankA, logId);
    await infra.enqueue(job);

    // Après épuisement des 3 tentatives : log FAILED + job en DLQ.
    await waitFor(async () => (await statusOf(logId)).status === "FAILED", 20_000);
    const row = await statusOf(logId);
    expect(row.status).toBe("FAILED");
    expect(row.failure_reason).toBe("PROVIDER_UNREACHABLE");

    const dlq = new Queue<DlqJobData>(DLQ_NAME, { connection, prefix: PREFIX });
    try {
      await waitFor(async () => (await dlq.getJobCountByTypes("waiting", "completed")) >= 1, 20_000);
      const jobs = await dlq.getJobs(["waiting", "completed", "active"]);
      const dead = jobs.find((j) => j.data.original.logId === logId);
      expect(dead).toBeDefined();
      expect(dead?.data.failureReason).toBe("PROVIDER_UNREACHABLE");
      expect(dead?.data.original.dedupeKey).toBe(job.dedupeKey);
      expect(dead?.data.fromQueue).toBe(channelQueueName("SMS"));
    } finally {
      await dlq.close();
    }
  }, 40_000);
});

describe("NOTIF-001 rejeu DLQ idempotent", () => {
  it("NOTIF-001: rejeu avec même dedupe_key → zéro doublon SENT/DELIVERED", async () => {
    // Le log est déjà DELIVERED (accusé webhook antérieur, CONTRACT-007).
    const logId = await insertQueuedLog(ids.bankA, "SMS");
    await db.query(`UPDATE notification_log SET status='DELIVERED' WHERE id=$1`, [logId]);

    let sends = 0;
    const okSend: SendFn = async () => {
      sends += 1;
      return { providerMessageId: "mid" };
    };
    infra = startNotificationInfra({ connection, queryFn, send: okSend });

    // Rejeu manuel depuis la DLQ : même dedupeKey.
    await infra.enqueue(jobFor(ids.bankA, logId));

    // Laisser le worker traiter : l'idempotence doit court-circuiter l'envoi.
    await new Promise((r) => setTimeout(r, 800));
    expect(sends).toBe(0);
    expect((await statusOf(logId)).status).toBe("DELIVERED");
  }, 40_000);
});

describe("NOTIF-001 garde tenant worker HORS RLS (D5)", () => {
  it("NOTIF-001: job d'une banque ne lit/écrit JAMAIS le log d'une autre banque", async () => {
    let sends = 0;
    const okSend: SendFn = async () => {
      sends += 1;
      return { providerMessageId: "mid" };
    };
    infra = startNotificationInfra({ connection, queryFn, send: okSend });

    // Log appartient à la banque A ; le job prétend être de la banque B.
    const logId = await insertQueuedLog(ids.bankA, "SMS");
    const rogueJob: NotificationJobData = {
      ...jobFor(ids.bankB, logId),
      logId, // pointe vers le log de A
      bankId: ids.bankB,
    };
    await infra.enqueue(rogueJob);

    // Le worker ouvre withTenant(bankB) : le log de A est INVISIBLE (RLS) ⇒ refus.
    // Le job échoue jusqu'à épuisement, va en DLQ, mais l'envoi n'est JAMAIS effectué
    // et le log de A n'est JAMAIS muté.
    await new Promise((r) => setTimeout(r, 1500));
    expect(sends).toBe(0);
    // Le log de A reste QUEUED, jamais SENT/FAILED par un tenant étranger.
    const row = await statusOf(logId);
    expect(row.status).toBe("QUEUED");
  }, 40_000);
});

describe("NOTIF-001 getQueueHealth (branchable /health)", () => {
  it("NOTIF-001: retourne les compteurs par file + DLQ", async () => {
    const okSend: SendFn = async () => ({ providerMessageId: "mid" });
    infra = startNotificationInfra({ connection, queryFn, send: okSend });

    const health = await infra.health();
    expect(health.channels).toHaveLength(NOTIFICATION_CHANNELS.length);
    for (const entry of health.channels) {
      expect(entry.counts).toHaveProperty("waiting");
      expect(entry.counts).toHaveProperty("failed");
      expect(entry.counts).toHaveProperty("delayed");
    }
    expect(health.dlq.name).toBe(DLQ_NAME);
    expect(health.healthy).toBe(true);
  });
});
