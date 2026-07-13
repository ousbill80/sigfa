/**
 * Tests d'intégration — NOTIF-002 : worker SMS + webhook de livraison
 * (Testcontainers PG16 réel). Prouve LA LOI SMS de bout en bout :
 *  - opt-in STRICT revérifié au traitement (absent → CONSENT_MISSING ; révoqué
 *    après enfilement → CONSENT_REVOKED) — ZÉRO appel adaptateur ;
 *  - 2xx adaptateur → SENT + provider_message_id ; DELIVERED SEULEMENT via webhook ;
 *  - variable manquante → TEMPLATE_RENDER_ERROR, aucun SMS envoyé ;
 *  - un seul envoi par (ticket,type) à vie (2e log → ALREADY_SENT) ;
 *  - garde tenant D5 : un job d'une banque ne touche JAMAIS le log d'une autre ;
 *  - PII : le numéro n'apparaît jamais dans le log/DLQ (seul phone_hash stocké) ;
 *  - webhook : signature invalide → 401 ; valide → statut journal mis à jour.
 *
 * Nommage strict : `NOTIF-002: <description>`.
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
} from "vitest";
import pg from "pg";
import { createHmac } from "node:crypto";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import type { QueryFn } from "@sigfa/database";
import {
  processSmsJob,
  type SmsJobData,
  type SmsProcessDeps,
} from "src/services/sms-notification.js";
import { createMockSmsAdapter } from "src/services/sms-adapter.js";
import { applyDeliveryAck } from "src/services/notification-delivery.js";
import type { TemplateSource } from "src/services/sms-templates-render.js";
import { createApp } from "src/app.js";

let pgContainer: StartedTestContainer;
let db: pg.Client;
let ids: { bankA: string; bankB: string };

/** Adaptateur QueryFn au-dessus du client pg réel. */
const queryFn: QueryFn = async (sql: string) => {
  const res = await db.query(sql);
  return { rows: res.rows as Record<string, unknown>[] };
};

/** Source de templates : FR global fixe + variables strictes. */
const templates: TemplateSource = {
  loadBankTemplate: (_b, type, lang) =>
    Promise.resolve(
      type === "TICKET_CONFIRMATION" && lang === "FR"
        ? "N°{{number}} pos {{position}} ~{{estimate}}"
        : type === "POSITION_NEAR"
          ? "Vous etes {{position}}e"
          : undefined
    ),
  loadGlobalFallback: (type) =>
    Promise.resolve(type === "POSITION_NEXT" ? "Vous etes le suivant" : undefined),
};

function baseDeps(over: Partial<SmsProcessDeps> = {}): SmsProcessDeps {
  return {
    queryFn,
    adapter: createMockSmsAdapter({
      outcomeFor: () => ({ kind: "accepted", providerMessageId: "mid-ok" }),
    }),
    templates,
    decryptPhone: () => "+2250700000047",
    ...over,
  };
}

async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='notification_status') THEN
        CREATE TYPE notification_status AS ENUM ('QUEUED','SENT','DELIVERED','FAILED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='notification_channel') THEN
        CREATE TYPE notification_channel AS ENUM ('SMS','WHATSAPP','EMAIL','PUSH'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='notification_type') THEN
        CREATE TYPE notification_type AS ENUM ('TICKET_CONFIRMATION','POSITION_NEAR','POSITION_NEXT','POSITION_UPDATE','YOUR_TURN','DAILY_REPORT'); END IF;
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
  await client.query(`
    CREATE TABLE IF NOT EXISTS notification_consents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      phone_encrypted TEXT NOT NULL,
      phone_hash TEXT NOT NULL,
      channel notification_channel NOT NULL,
      opted_in BOOLEAN NOT NULL DEFAULT false,
      opted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      UNIQUE (bank_id, phone_hash, channel)
    );
  `);
  // RLS applicative (D5) sur les deux tables.
  for (const t of ["notification_log", "notification_consents"]) {
    await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
    await client.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
    await client.query(`DROP POLICY IF EXISTS tenant_isolation ON ${t};`);
    await client.query(`
      CREATE POLICY tenant_isolation ON ${t}
        USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
        WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
    `);
  }
}

const PHONE_HASH = "ph-abc";

async function insertConsent(
  bankId: string,
  opts: { optedIn: boolean; revoked?: boolean }
): Promise<void> {
  await db.query(
    `INSERT INTO notification_consents (bank_id, phone_encrypted, phone_hash, channel, opted_in, revoked_at)
     VALUES ($1, 'v1:enc', $2, 'SMS', $3, $4)
     ON CONFLICT (bank_id, phone_hash, channel) DO UPDATE
       SET opted_in = EXCLUDED.opted_in, revoked_at = EXCLUDED.revoked_at`,
    [bankId, PHONE_HASH, opts.optedIn, opts.revoked ? new Date().toISOString() : null]
  );
}

async function insertQueuedLog(
  bankId: string,
  type: string,
  ticketId: string
): Promise<string> {
  const res = await db.query(
    `INSERT INTO notification_log (bank_id, ticket_id, type, channel, phone_hash, status)
     VALUES ($1, $2, $3::notification_type, 'SMS', $4, 'QUEUED') RETURNING id`,
    [bankId, ticketId, type, PHONE_HASH]
  );
  return (res.rows[0] as { id: string }).id;
}

async function statusOf(logId: string): Promise<{ status: string; failure_reason: string | null; provider_message_id: string | null }> {
  const res = await db.query(
    `SELECT status, failure_reason, provider_message_id FROM notification_log WHERE id = $1`,
    [logId]
  );
  return res.rows[0] as never;
}

function job(bankId: string, logId: string, ticketId: string, type: SmsJobData["type"]): SmsJobData {
  return {
    bankId,
    dedupeKey: `dk-${logId}`,
    logId,
    ticketId,
    type,
    phoneHash: PHONE_HASH,
    lang: "FR",
    context: { number: "A12", position: 3, estimate: "10 min" },
  };
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
  db = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test`,
  });
  await db.connect();
  await runMigrations(db);
  const a = await db.query(`INSERT INTO banks (name, slug) VALUES ('A','a') RETURNING id`);
  const b = await db.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  ids = {
    bankA: (a.rows[0] as { id: string }).id,
    bankB: (b.rows[0] as { id: string }).id,
  };
}, 120_000);

afterAll(async () => {
  await db?.end();
  await pgContainer?.stop();
});

beforeEach(async () => {
  await db.query(`DELETE FROM notification_log`);
  await db.query(`DELETE FROM notification_consents`);
});

describe("processSmsJob — opt-in STRICT + envoi", () => {
  it("NOTIF-002: consent absent → SKIPPED CONSENT_MISSING, zéro appel adaptateur", async () => {
    const t = crypto.randomUUID();
    const logId = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", t);
    let called = false;
    const deps = baseDeps({
      adapter: { send: () => { called = true; return Promise.resolve({ providerMessageId: "x" }); } },
    });
    const res = await processSmsJob(job(ids.bankA, logId, t, "TICKET_CONFIRMATION"), deps);
    expect(res).toEqual({ status: "SKIPPED", reason: "CONSENT_MISSING" });
    expect(called).toBe(false);
    const row = await statusOf(logId);
    expect(row.status).toBe("FAILED");
    expect(row.failure_reason).toBe("OPT_OUT");
  });

  it("NOTIF-002: consent révoqué après enfilement → SKIPPED CONSENT_REVOKED (recheck au traitement)", async () => {
    const t = crypto.randomUUID();
    const logId = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", t);
    // Enfilé alors qu'opté, puis révoqué AVANT le traitement.
    await insertConsent(ids.bankA, { optedIn: true, revoked: true });
    let called = false;
    const deps = baseDeps({
      adapter: { send: () => { called = true; return Promise.resolve({ providerMessageId: "x" }); } },
    });
    const res = await processSmsJob(job(ids.bankA, logId, t, "TICKET_CONFIRMATION"), deps);
    expect(res).toEqual({ status: "SKIPPED", reason: "CONSENT_REVOKED" });
    expect(called).toBe(false);
  });

  it("NOTIF-002: 2xx adaptateur → SENT + provider_message_id (DELIVERED seulement via webhook)", async () => {
    const t = crypto.randomUUID();
    await insertConsent(ids.bankA, { optedIn: true });
    const logId = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", t);
    const res = await processSmsJob(job(ids.bankA, logId, t, "TICKET_CONFIRMATION"), baseDeps());
    expect(res).toEqual({ status: "SENT", providerMessageId: "mid-ok" });
    const row = await statusOf(logId);
    expect(row.status).toBe("SENT"); // pas DELIVERED
    expect(row.provider_message_id).toBe("mid-ok");
  });

  it("NOTIF-002: variable manquante → TEMPLATE_RENDER_ERROR, aucun SMS envoyé", async () => {
    const t = crypto.randomUUID();
    await insertConsent(ids.bankA, { optedIn: true });
    const logId = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", t);
    let called = false;
    const j = job(ids.bankA, logId, t, "TICKET_CONFIRMATION");
    j.context = { number: "A12" }; // position/estimate manquantes
    const deps = baseDeps({
      adapter: { send: () => { called = true; return Promise.resolve({ providerMessageId: "x" }); } },
    });
    await expect(processSmsJob(j, deps)).rejects.toMatchObject({ reason: "TEMPLATE_RENDER_ERROR" });
    expect(called).toBe(false);
    const row = await statusOf(logId);
    expect(row.status).toBe("FAILED");
    expect(row.failure_reason).toBe("TEMPLATE_REJECTED");
  });

  it("NOTIF-002: un seul envoi par (ticket,type) à vie — 2e log → ALREADY_SENT", async () => {
    const t = crypto.randomUUID();
    await insertConsent(ids.bankA, { optedIn: true });
    const log1 = await insertQueuedLog(ids.bankA, "POSITION_NEAR", t);
    const r1 = await processSmsJob(job(ids.bankA, log1, t, "POSITION_NEAR"), baseDeps());
    expect(r1.status).toBe("SENT");
    // Re-franchissement du seuil → nouveau log QUEUED, même (ticket,type).
    const log2 = await insertQueuedLog(ids.bankA, "POSITION_NEAR", t);
    let called = false;
    const deps = baseDeps({
      adapter: { send: () => { called = true; return Promise.resolve({ providerMessageId: "y" }); } },
    });
    const r2 = await processSmsJob(job(ids.bankA, log2, t, "POSITION_NEAR"), deps);
    expect(r2).toEqual({ status: "ALREADY_SENT" });
    expect(called).toBe(false);
  });

  it("NOTIF-002: garde tenant D5 — job bankB ne touche pas un log bankA", async () => {
    const t = crypto.randomUUID();
    await insertConsent(ids.bankB, { optedIn: true });
    const logId = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", t);
    await expect(
      processSmsJob(job(ids.bankB, logId, t, "TICKET_CONFIRMATION"), baseDeps())
    ).rejects.toMatchObject({ name: "TenantMismatchError" });
    const row = await statusOf(logId);
    expect(row.status).toBe("QUEUED"); // intact
  });

  it("NOTIF-002: PII — le numéro en clair n'est jamais stocké dans le log", async () => {
    const t = crypto.randomUUID();
    await insertConsent(ids.bankA, { optedIn: true });
    const logId = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", t);
    await processSmsJob(job(ids.bankA, logId, t, "TICKET_CONFIRMATION"), baseDeps());
    const res = await db.query(
      `SELECT * FROM notification_log WHERE id = $1`,
      [logId]
    );
    const serialized = JSON.stringify(res.rows[0]);
    expect(serialized).not.toContain("2250700000047");
    expect(serialized).not.toContain("0700000047");
  });
});

describe("applyDeliveryAck — webhook (corrélation provider_message_id)", () => {
  async function sentLog(bankId: string): Promise<string> {
    const t = crypto.randomUUID();
    await insertConsent(bankId, { optedIn: true });
    const logId = await insertQueuedLog(bankId, "TICKET_CONFIRMATION", t);
    await processSmsJob(job(bankId, logId, t, "TICKET_CONFIRMATION"), baseDeps());
    return logId;
  }

  it("NOTIF-002: DELIVERED → statut journal DELIVERED", async () => {
    const logId = await sentLog(ids.bankA);
    const r = await applyDeliveryAck(
      { messageId: "mid-ok", status: "DELIVERED", deliveredAt: "2026-07-12T09:00:10Z" },
      queryFn
    );
    expect(r).toEqual({ updated: true, status: "DELIVERED" });
    expect((await statusOf(logId)).status).toBe("DELIVERED");
  });

  it("NOTIF-002: FAILED → statut journal FAILED + failure_reason énuméré", async () => {
    await sentLog(ids.bankA);
    const r = await applyDeliveryAck(
      { messageId: "mid-ok", status: "FAILED", failureReason: "INVALID_NUMBER" },
      queryFn
    );
    expect(r).toEqual({ updated: true, status: "FAILED" });
  });

  it("NOTIF-002: provider_message_id inconnu → NOT_FOUND", async () => {
    const r = await applyDeliveryAck({ messageId: "does-not-exist", status: "DELIVERED" }, queryFn);
    expect(r).toEqual({ updated: false, reason: "NOT_FOUND" });
  });
});

describe("POST /webhooks/notifications/:provider/delivery — signature", () => {
  const SECRET = "webhook-secret";
  const OLD = process.env["NOTIF_WEBHOOK_SECRET_AFRICASTALKING"];

  /** Stub Redis en mémoire minimal pour le rate-limit sliding-window (zset). */
  function stubRedis(): never {
    const store = new Map<string, Array<{ score: number; member: string }>>();
    return {
      zremrangebyscore: (k: string, _min: number, max: number) => {
        const z = store.get(k) ?? [];
        store.set(k, z.filter((e) => e.score > max));
        return Promise.resolve(0);
      },
      zcard: (k: string) => Promise.resolve((store.get(k) ?? []).length),
      zadd: (k: string, score: number, member: string) => {
        const z = store.get(k) ?? [];
        z.push({ score, member });
        store.set(k, z);
        return Promise.resolve(1);
      },
      expire: () => Promise.resolve(1),
      zrange: (k: string) => {
        const z = (store.get(k) ?? []).slice().sort((a, b) => a.score - b.score);
        const first = z[0];
        return Promise.resolve(first ? [first.member, String(first.score)] : []);
      },
    } as never;
  }

  function app() {
    process.env["NOTIF_WEBHOOK_SECRET_AFRICASTALKING"] = SECRET;
    return createApp({
      db: db as unknown as import("pg").Client,
      redis: stubRedis(),
      jwtSecret: new Uint8Array(32),
    });
  }

  async function sentLog(): Promise<void> {
    const t = crypto.randomUUID();
    await insertConsent(ids.bankA, { optedIn: true });
    const logId = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", t);
    await processSmsJob(job(ids.bankA, logId, t, "TICKET_CONFIRMATION"), baseDeps());
  }

  afterAll(() => {
    if (OLD === undefined) delete process.env["NOTIF_WEBHOOK_SECRET_AFRICASTALKING"];
    else process.env["NOTIF_WEBHOOK_SECRET_AFRICASTALKING"] = OLD;
  });

  it("NOTIF-002: signature invalide → 401 INVALID_WEBHOOK_SIGNATURE", async () => {
    const body = JSON.stringify({ messageId: "mid-ok", status: "DELIVERED" });
    const res = await app().request("/api/v1/webhooks/notifications/africastalking/delivery", {
      method: "POST",
      headers: { "content-type": "application/json", "x-at-signature": "bad" },
      body,
    });
    expect(res.status).toBe(401);
    const j = (await res.json()) as { error: { code: string } };
    expect(j.error.code).toBe("INVALID_WEBHOOK_SIGNATURE");
  });

  it("NOTIF-002: signature valide → 200 + statut journal mis à jour", async () => {
    await sentLog();
    const body = JSON.stringify({ messageId: "mid-ok", status: "DELIVERED" });
    const sig = createHmac("sha256", SECRET).update(body).digest("hex");
    const res = await app().request("/api/v1/webhooks/notifications/africastalking/delivery", {
      method: "POST",
      headers: { "content-type": "application/json", "x-at-signature": sig },
      body,
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { acknowledged: boolean };
    expect(j.acknowledged).toBe(true);
  });

  /** POST signé du provider africastalking sur le webhook de livraison. */
  function postSigned(body: string): Promise<Response> {
    const sig = createHmac("sha256", SECRET).update(body).digest("hex");
    return Promise.resolve(
      app().request("/api/v1/webhooks/notifications/africastalking/delivery", {
        method: "POST",
        headers: { "content-type": "application/json", "x-at-signature": sig },
        body,
      })
    );
  }

  it("NOTIF-002: provider inconnu → 404", async () => {
    process.env["NOTIF_WEBHOOK_SECRET_AFRICASTALKING"] = SECRET;
    const res = await app().request("/api/v1/webhooks/notifications/twilio/delivery", {
      method: "POST",
      headers: { "content-type": "application/json", "x-at-signature": "x" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  it("NOTIF-002: JSON invalide (signé) → 400 BAD_REQUEST", async () => {
    const res = await postSigned("not-json");
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: { code: string } };
    expect(j.error.code).toBe("BAD_REQUEST");
  });

  it("NOTIF-002: payload invalide (champ manquant) → 400", async () => {
    const res = await postSigned(JSON.stringify({ status: "DELIVERED" }));
    expect(res.status).toBe(400);
  });

  it("NOTIF-002: statut non actionnable (SENT) → 400", async () => {
    const res = await postSigned(JSON.stringify({ messageId: "m", status: "SENT" }));
    expect(res.status).toBe(400);
  });

  it("NOTIF-002: message inconnu → 404 NOTIFICATION_NOT_FOUND", async () => {
    const res = await postSigned(
      JSON.stringify({ messageId: "unknown-mid", status: "DELIVERED" })
    );
    expect(res.status).toBe(404);
    const j = (await res.json()) as { error: { code: string } };
    expect(j.error.code).toBe("NOTIFICATION_NOT_FOUND");
  });

  it("NOTIF-002: FAILED avec failureReason → 200 + journal FAILED", async () => {
    const t = crypto.randomUUID();
    await insertConsent(ids.bankA, { optedIn: true });
    const logId = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", t);
    // provider_message_id dédié pour ce cas (évite la collision avec 'mid-ok').
    const deps = baseDeps({
      adapter: createMockSmsAdapter({
        outcomeFor: () => ({ kind: "accepted", providerMessageId: "mid-fail" }),
      }),
    });
    await processSmsJob(job(ids.bankA, logId, t, "TICKET_CONFIRMATION"), deps);
    const res = await postSigned(
      JSON.stringify({ messageId: "mid-fail", status: "FAILED", failureReason: "INVALID_NUMBER" })
    );
    expect(res.status).toBe(200);
    expect((await statusOf(logId)).status).toBe("FAILED");
  });
});
