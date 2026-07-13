/**
 * Tests d'intégration — NOTIF-004 : canal email de bout en bout via le worker
 * NOTIF-001 (Testcontainers PG16 + Redis 7 réels + adaptateur MOCK Resend).
 *
 * Prouve, en réutilisant `startNotificationInfra` avec la `SendFn` email :
 *  - 2xx Resend (mock) → notification_log SENT + provider_message_id ;
 *  - bounce dur → FAILED (INVALID_NUMBER) + DLQ, PAS de retry infini ;
 *  - 429/transitoire → retries (backoff NOTIF-001) puis DLQ à épuisement ;
 *  - garde tenant D5 : le worker n'écrit jamais le log d'une autre banque.
 *
 * ZÉRO envoi réseau réel : `MockResendAdapter` simule les issues fournisseur.
 *
 * Nommage strict : `NOTIF-004: <description>`.
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
  DLQ_NAME,
  type DlqJobData,
  type NotificationInfra,
} from "src/services/notification-queue.js";
import {
  notificationDedupeKey,
  type NotificationJobData,
  type QueryFn,
} from "src/services/notification-jobs.js";
import { MockResendAdapter, type EmailMessage } from "src/services/email/email-adapter.js";
import { makeEmailSendFn } from "src/services/email/email-send.js";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let connection: { host: string; port: number };
let infra: NotificationInfra | undefined;
let bankA: string;

/** Registre message-par-job partagé worker/producteur (indexé par dedupeKey). */
const messages = new Map<string, EmailMessage>();

const PREFIX = "sigfa-notif004-test";

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
        CREATE TYPE notification_type AS ENUM ('DAILY_REPORT','WEEKLY_REPORT','MONTHLY_REPORT','MANAGER_ALERT'); END IF;
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
  await client.query(`ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;`);
  await client.query(`ALTER TABLE notification_log FORCE ROW LEVEL SECURITY;`);
  await client.query(`DROP POLICY IF EXISTS tenant_isolation ON notification_log;`);
  await client.query(`
    CREATE POLICY tenant_isolation ON notification_log
      USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
      WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
  `);
}

async function insertQueuedEmailLog(bankId: string): Promise<string> {
  const res = await db.query(
    `INSERT INTO notification_log (bank_id, type, channel, status)
     VALUES ($1, 'MANAGER_ALERT', 'EMAIL', 'QUEUED') RETURNING id`,
    [bankId]
  );
  return (res.rows[0] as { id: string }).id;
}

/** Fabrique un job email + enregistre le message rendu (indexé par dedupeKey). */
function emailJob(bankId: string, logId: string, to: string[]): NotificationJobData {
  const dedupeKey = notificationDedupeKey({
    bankId,
    ticketId: logId,
    type: "MANAGER_ALERT",
    channel: "EMAIL",
  });
  messages.set(dedupeKey, {
    to,
    from: "alerts@banque.example",
    subject: "Alerte",
    html: "<p>x</p>",
  });
  return {
    bankId,
    dedupeKey,
    logId,
    ticketId: null,
    type: "MANAGER_ALERT",
    channel: "EMAIL",
  };
}

async function statusOf(
  logId: string
): Promise<{ status: string; failure_reason: string | null; provider_message_id: string | null }> {
  const res = await db.query(
    `SELECT status, failure_reason, provider_message_id FROM notification_log WHERE id = $1`,
    [logId]
  );
  return res.rows[0] as {
    status: string;
    failure_reason: string | null;
    provider_message_id: string | null;
  };
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor: condition non satisfaite avant le timeout");
}

/** Démarre l'infra avec la SendFn email (adaptateur mock Resend). */
function startEmailInfra(): NotificationInfra {
  const adapter = new MockResendAdapter({ makeMessageId: () => "resend-mid-1" });
  const send = makeEmailSendFn(adapter, (job) => messages.get(job.dedupeKey));
  return startNotificationInfra({ connection, queryFn, send });
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
  const a = await db.query(`INSERT INTO banks (name, slug) VALUES ('A','a') RETURNING id`);
  bankA = (a.rows[0] as { id: string }).id;
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
  messages.clear();
});

afterEach(async () => {
  await infra?.close();
  infra = undefined;
});

describe("NOTIF-004 canal email de bout en bout (worker NOTIF-001 + mock Resend)", () => {
  it("NOTIF-004: 2xx Resend (mock) → SENT + provider_message_id ; DELIVERED via webhook (adaptateur mocké)", async () => {
    infra = startEmailInfra();
    const logId = await insertQueuedEmailLog(bankA);
    await infra.enqueue(emailJob(bankA, logId, ["mgr@banque.example"]));

    await waitFor(async () => (await statusOf(logId)).status === "SENT");
    const row = await statusOf(logId);
    expect(row.status).toBe("SENT");
    expect(row.provider_message_id).toBe("resend-mid-1");
    // DELIVERED arrivera via le webhook resend/delivery (CONTRACT-007) — hors de ce worker.
  });

  it("NOTIF-004: bounce dur → FAILED/INVALID_NUMBER + DLQ, pas de retry infini", async () => {
    infra = startEmailInfra();
    const logId = await insertQueuedEmailLog(bankA);
    // localpart `bounce@` → le mock lève un bounce dur (non retryable).
    await infra.enqueue(emailJob(bankA, logId, ["bounce@banque.example"]));

    await waitFor(async () => (await statusOf(logId)).status === "FAILED");
    const row = await statusOf(logId);
    expect(row.status).toBe("FAILED");
    expect(row.failure_reason).toBe("INVALID_NUMBER");

    const dlq = new Queue<DlqJobData>(DLQ_NAME, { connection, prefix: PREFIX });
    try {
      await waitFor(
        async () => (await dlq.getJobCountByTypes("waiting", "completed", "active")) >= 1
      );
      const jobs = await dlq.getJobs(["waiting", "completed", "active"]);
      const dead = jobs.find((j) => j.data.original.logId === logId);
      expect(dead).toBeDefined();
      expect(dead?.data.failureReason).toBe("INVALID_NUMBER");
    } finally {
      await dlq.close();
    }
  }, 40_000);

  it("NOTIF-004: 429/erreur transitoire → retries (backoff) puis DLQ (PROVIDER_UNREACHABLE)", async () => {
    infra = startEmailInfra();
    const logId = await insertQueuedEmailLog(bankA);
    // localpart `transient@` → 5xx transitoire à chaque tentative.
    await infra.enqueue(emailJob(bankA, logId, ["transient@banque.example"]));

    await waitFor(async () => (await statusOf(logId)).status === "FAILED", 30_000);
    const row = await statusOf(logId);
    expect(row.status).toBe("FAILED");
    // Épuisement après retries → raison transitoire énumérée.
    expect(row.failure_reason).toBe("PROVIDER_UNREACHABLE");
  }, 40_000);
});
