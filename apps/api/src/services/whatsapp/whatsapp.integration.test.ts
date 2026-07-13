/**
 * Tests d'intégration — NOTIF-003 : worker WhatsApp SORTANT + traitement ENTRANT
 * (Testcontainers PG16 réel). Prouve LA LOI de bout en bout :
 *  - Sortant : opt-in STRICT PAR CANAL revérifié — opt-in SMS ne vaut PAS opt-in
 *    WhatsApp (→ CONSENT_MISSING) ; opt-in WHATSAPP présent → SENT ;
 *    un seul envoi par (ticket,type) à vie (2e log → ALREADY_SENT) ;
 *  - Entrant : « prendre ticket » → ticket API-003 canal WHATSAPP + réponse position ;
 *    redélivrance (même provider_message_id) → un seul ticket (idempotence) ;
 *    « état » → position temps réel du ticket du phone_hash ;
 *    premier inbound → opt-in WHATSAPP tracé (source INBOUND_WHATSAPP) ;
 *    intention ambiguë → aide FR/EN, zéro ticket ;
 *  - Garde tenant D5 : job/inbound d'une banque ne touche jamais l'autre.
 *
 * Nommage strict : `NOTIF-003: <description>`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import type { QueryFn } from "@sigfa/database";
import {
  processWhatsAppJob,
  type WhatsAppJobData,
  type WhatsAppProcessDeps,
} from "src/services/whatsapp/whatsapp-notification.js";
import { createMockWhatsAppAdapter } from "src/services/whatsapp/whatsapp-adapter.js";
import {
  processInboundMessage,
  type InboundDeps,
  type IssueTicketPort,
  type PhoneCryptoPort,
  type ResolvedWhatsAppConfig,
} from "src/services/whatsapp/whatsapp-inbound.js";
import type { TemplateSource } from "src/services/sms-templates-render.js";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import {
  createWhatsAppInboundRouter,
  resolveWhatsAppConfig,
} from "src/routes/webhooks-whatsapp-inbound.js";
import { createNoopBus } from "src/services/realtime.js";

let pgContainer: StartedTestContainer;
let db: pg.Client;
let ids: { bankA: string; bankB: string; agencyA: string; queueA: string; serviceA: string };

const queryFn: QueryFn = async (sql: string) => {
  const res = await db.query(sql);
  return { rows: res.rows as Record<string, unknown>[] };
};

const templates: TemplateSource = {
  loadBankTemplate: (_b, type, lang) =>
    Promise.resolve(
      type === "TICKET_CONFIRMATION" && lang === "FR"
        ? "N°{{number}} pos {{position}} ~{{estimate}}"
        : undefined
    ),
  loadGlobalFallback: () => Promise.resolve(undefined),
};

/** Crypto déterministe (pas de dépendance aux clés d'env réelles). */
const crypto: PhoneCryptoPort = {
  normalizePhone: (r) => r.replace(/[^\d+]/g, ""),
  hashPhone: (r) => `h:${r.replace(/[^\d+]/g, "")}`,
  encryptPhone: (r) => `v1:enc:${r.replace(/[^\d+]/g, "")}`,
};

function outboundDeps(over: Partial<WhatsAppProcessDeps> = {}): WhatsAppProcessDeps {
  return {
    queryFn,
    adapter: createMockWhatsAppAdapter({
      outcomeFor: () => ({ kind: "accepted", providerMessageId: "wa-mid-ok" }),
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
        CREATE TYPE notification_type AS ENUM ('TICKET_CONFIRMATION','POSITION_NEAR','POSITION_NEXT'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='notification_failure_reason') THEN
        CREATE TYPE notification_failure_reason AS ENUM ('PROVIDER_UNREACHABLE','INVALID_NUMBER','OPT_OUT','TEMPLATE_REJECTED','QUOTA_EXCEEDED','UNKNOWN'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='consent_source') THEN
        CREATE TYPE consent_source AS ENUM ('AGENT','KIOSK','WEB','INBOUND_WHATSAPP','IMPORT'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_status') THEN
        CREATE TYPE ticket_status AS ENUM ('WAITING','CALLED','SERVING','DONE','NO_SHOW','CANCELLED'); END IF;
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
      source consent_source,
      UNIQUE (bank_id, phone_hash, channel)
    );
  `);
  // Table d'idempotence des messages entrants (NOTIF-003).
  await client.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_inbound_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      provider_message_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (bank_id, provider_message_id)
    );
  `);
  // Tickets (sous-ensemble utile à la consultation d'état entrante).
  await client.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      queue_id UUID NOT NULL,
      number INTEGER NOT NULL,
      display_number TEXT,
      status ticket_status NOT NULL DEFAULT 'WAITING',
      phone_hash TEXT,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Config WhatsApp par banque (C4) + mapping menu — routage tenant par bankSlug.
  await client.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_config (
      bank_id UUID PRIMARY KEY REFERENCES banks(id),
      business_number TEXT,
      webhook_secret TEXT,
      default_agency_id UUID
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_menu_mapping (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      keyword TEXT NOT NULL,
      service_id UUID NOT NULL
    );
  `);
  for (const t of ["notification_log", "notification_consents", "whatsapp_inbound_messages", "tickets"]) {
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

const PHONE = "+2250700000047";
const PHONE_HASH = crypto.hashPhone(PHONE);
const SERVICE = "88888888-8888-4888-a888-888888888888";

async function insertConsentWhatsApp(bankId: string, opts: { optedIn: boolean; revoked?: boolean }): Promise<void> {
  await db.query(
    `INSERT INTO notification_consents (bank_id, phone_encrypted, phone_hash, channel, opted_in, revoked_at)
     VALUES ($1, 'v1:enc', $2, 'WHATSAPP', $3, $4)
     ON CONFLICT (bank_id, phone_hash, channel) DO UPDATE SET opted_in = EXCLUDED.opted_in, revoked_at = EXCLUDED.revoked_at`,
    [bankId, PHONE_HASH, opts.optedIn, opts.revoked ? new Date().toISOString() : null]
  );
}

async function insertConsentSms(bankId: string): Promise<void> {
  await db.query(
    `INSERT INTO notification_consents (bank_id, phone_encrypted, phone_hash, channel, opted_in)
     VALUES ($1, 'v1:enc', $2, 'SMS', true)
     ON CONFLICT (bank_id, phone_hash, channel) DO NOTHING`,
    [bankId, PHONE_HASH]
  );
}

async function insertQueuedLog(bankId: string, type: string, ticketId: string): Promise<string> {
  const res = await db.query(
    `INSERT INTO notification_log (bank_id, ticket_id, type, channel, phone_hash, status)
     VALUES ($1, $2, $3::notification_type, 'WHATSAPP', $4, 'QUEUED') RETURNING id`,
    [bankId, ticketId, type, PHONE_HASH]
  );
  return (res.rows[0] as { id: string }).id;
}

async function statusOf(logId: string): Promise<{ status: string; failure_reason: string | null; provider_message_id: string | null }> {
  const res = await db.query(`SELECT status, failure_reason, provider_message_id FROM notification_log WHERE id = $1`, [logId]);
  return res.rows[0] as never;
}

function job(bankId: string, logId: string, ticketId: string, type: WhatsAppJobData["type"]): WhatsAppJobData {
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

/** Port d'émission de ticket réel-mémoire : insère un ticket WAITING. */
function issuePort(bankId: string, queueId: string): IssueTicketPort {
  return {
    issue: async ({ serviceId, phoneNumber }) => {
      const num = 12;
      const res = await db.query(
        `INSERT INTO tickets (bank_id, queue_id, number, display_number, status, phone_hash)
         VALUES ($1, $2, $3, $4, 'WAITING', $5) RETURNING id`,
        [bankId, queueId, num, `A${String(num).padStart(3, "0")}`, crypto.hashPhone(crypto.normalizePhone(phoneNumber))]
      );
      void serviceId;
      void (res.rows[0] as { id: string }).id;
      return { number: `A${String(num).padStart(3, "0")}`, position: 1, estimatedWaitMinutes: 5 };
    },
  };
}

function inboundConfig(bankId: string, agencyId: string): ResolvedWhatsAppConfig {
  return {
    bankId,
    agencyId,
    webhookSecret: "wa-secret",
    menuMapping: [{ keyword: "1", serviceId: SERVICE }],
  };
}

function inboundDeps(bankId: string, agencyId: string, queueId: string, lang: "FR" | "EN" = "FR"): InboundDeps {
  return { queryFn, config: inboundConfig(bankId, agencyId), crypto, issueTicket: issuePort(bankId, queueId), lang };
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
  const a = await db.query(`INSERT INTO banks (name, slug) VALUES ('A','a') RETURNING id`);
  const b = await db.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  ids = {
    bankA: (a.rows[0] as { id: string }).id,
    bankB: (b.rows[0] as { id: string }).id,
    agencyA: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    queueA: "cccccccc-cccc-4ccc-accc-cccccccccccc",
    serviceA: SERVICE,
  };
}, 180_000);

afterAll(async () => {
  await db?.end();
  await pgContainer?.stop();
});

beforeEach(async () => {
  await db.query(`DELETE FROM notification_log`);
  await db.query(`DELETE FROM notification_consents`);
  await db.query(`DELETE FROM whatsapp_inbound_messages`);
  await db.query(`DELETE FROM tickets`);
});

describe("NOTIF-003 — WhatsApp sortant", () => {
  it("NOTIF-003: sortant sans opt-in WHATSAPP (même si opt-in SMS) → SKIPPED/CONSENT_MISSING", async () => {
    await insertConsentSms(ids.bankA); // opt-in SMS présent, WhatsApp absent.
    const logId = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", "11111111-1111-4111-a111-111111111111");
    const res = await processWhatsAppJob(job(ids.bankA, logId, "11111111-1111-4111-a111-111111111111", "TICKET_CONFIRMATION"), outboundDeps());
    expect(res).toEqual({ status: "SKIPPED", reason: "CONSENT_MISSING" });
    const s = await statusOf(logId);
    expect(s.status).toBe("FAILED");
    expect(s.failure_reason).toBe("OPT_OUT");
  });

  it("NOTIF-003: avancement avec opt-in WHATSAPP → SENT + provider_message_id (template rendu)", async () => {
    await insertConsentWhatsApp(ids.bankA, { optedIn: true });
    const logId = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", "22222222-2222-4222-a222-222222222222");
    const res = await processWhatsAppJob(job(ids.bankA, logId, "22222222-2222-4222-a222-222222222222", "TICKET_CONFIRMATION"), outboundDeps());
    expect(res).toEqual({ status: "SENT", providerMessageId: "wa-mid-ok" });
    const s = await statusOf(logId);
    expect(s.status).toBe("SENT");
    expect(s.provider_message_id).toBe("wa-mid-ok");
  });

  it("NOTIF-003: un seul envoi par (ticket,type) à vie → 2e log = ALREADY_SENT", async () => {
    await insertConsentWhatsApp(ids.bankA, { optedIn: true });
    const t = "33333333-3333-4333-a333-333333333333";
    const first = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", t);
    await processWhatsAppJob(job(ids.bankA, first, t, "TICKET_CONFIRMATION"), outboundDeps());
    const second = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", t);
    const res = await processWhatsAppJob(job(ids.bankA, second, t, "TICKET_CONFIRMATION"), outboundDeps());
    expect(res).toEqual({ status: "ALREADY_SENT" });
  });

  it("NOTIF-003: garde tenant D5 — job bank A ne touche jamais le log de bank B", async () => {
    await insertConsentWhatsApp(ids.bankB, { optedIn: true });
    const logB = await insertQueuedLog(ids.bankB, "TICKET_CONFIRMATION", "44444444-4444-4444-a444-444444444444");
    await expect(
      processWhatsAppJob(job(ids.bankA, logB, "44444444-4444-4444-a444-444444444444", "TICKET_CONFIRMATION"), outboundDeps())
    ).rejects.toMatchObject({ name: "TenantMismatchError" });
    const s = await statusOf(logB);
    expect(s.status).toBe("QUEUED"); // intact.
  });

  it("NOTIF-003: variable de template manquante → TEMPLATE_RENDER_ERROR, log FAILED (TEMPLATE_REJECTED), aucun envoi", async () => {
    await insertConsentWhatsApp(ids.bankA, { optedIn: true });
    const t = "55555555-5555-4555-a555-555555555555";
    const logId = await insertQueuedLog(ids.bankA, "TICKET_CONFIRMATION", t);
    const j = job(ids.bankA, logId, t, "TICKET_CONFIRMATION");
    // Contexte SANS `number` (référencé par le template) → rendu impossible.
    j.context = { position: 3, estimate: "10 min" };
    await expect(processWhatsAppJob(j, outboundDeps())).rejects.toMatchObject({
      name: "TemplateRenderError",
    });
    const s = await statusOf(logId);
    expect(s.status).toBe("FAILED");
    expect(s.failure_reason).toBe("TEMPLATE_REJECTED");
    expect(s.provider_message_id).toBeNull();
  });
});

describe("NOTIF-003 — WhatsApp entrant", () => {
  it("NOTIF-003: inbound « 1 » (menu) → ticket API-003 canal WHATSAPP + réponse position", async () => {
    const res = await processInboundMessage(
      { from: PHONE, text: "1", providerMessageId: "wamid-take-1" },
      inboundDeps(ids.bankA, ids.agencyA, ids.queueA)
    );
    expect(res.kind).toBe("TICKET_CREATED");
    if (res.kind === "TICKET_CREATED") {
      expect(res.reply).toContain("A012");
      expect(res.deduped).toBe(false);
    }
    const cnt = await db.query(`SELECT COUNT(*)::int AS n FROM tickets WHERE bank_id = $1`, [ids.bankA]);
    expect((cnt.rows[0] as { n: number }).n).toBe(1);
  });

  it("NOTIF-003: inbound redélivré (même provider_message_id) → un seul ticket (idempotence)", async () => {
    const deps = inboundDeps(ids.bankA, ids.agencyA, ids.queueA);
    await processInboundMessage({ from: PHONE, text: "1", providerMessageId: "wamid-dup" }, deps);
    const second = await processInboundMessage({ from: PHONE, text: "1", providerMessageId: "wamid-dup" }, deps);
    expect(second.kind).toBe("DEDUPED");
    const cnt = await db.query(`SELECT COUNT(*)::int AS n FROM tickets WHERE bank_id = $1`, [ids.bankA]);
    expect((cnt.rows[0] as { n: number }).n).toBe(1);
  });

  it("NOTIF-003: premier inbound → opt-in WHATSAPP tracé (source INBOUND_WHATSAPP), autres canaux inchangés", async () => {
    await processInboundMessage({ from: PHONE, text: "1", providerMessageId: "wamid-optin" }, inboundDeps(ids.bankA, ids.agencyA, ids.queueA));
    const c = await db.query(
      `SELECT channel, opted_in, source FROM notification_consents WHERE bank_id = $1 AND phone_hash = $2`,
      [ids.bankA, PHONE_HASH]
    );
    const rows = c.rows as { channel: string; opted_in: boolean; source: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "WHATSAPP", opted_in: true, source: "INBOUND_WHATSAPP" });
  });

  it("NOTIF-003: inbound « état » → position temps réel du ticket du phone_hash", async () => {
    // Un ticket actif pré-existant pour ce phone_hash.
    await db.query(
      `INSERT INTO tickets (bank_id, queue_id, number, display_number, status, phone_hash)
       VALUES ($1, $2, 7, 'A007', 'WAITING', $3)`,
      [ids.bankA, ids.queueA, PHONE_HASH]
    );
    const res = await processInboundMessage(
      { from: PHONE, text: "quel est l'état de mon ticket", providerMessageId: "wamid-status" },
      inboundDeps(ids.bankA, ids.agencyA, ids.queueA)
    );
    expect(res.kind).toBe("STATUS");
    if (res.kind === "STATUS") expect(res.reply).toContain("A007");
  });

  it("NOTIF-003: intention ambiguë → aide FR/EN, zéro ticket", async () => {
    const res = await processInboundMessage(
      { from: PHONE, text: "bonjour ça va", providerMessageId: "wamid-help" },
      inboundDeps(ids.bankA, ids.agencyA, ids.queueA, "EN")
    );
    expect(res.kind).toBe("HELP");
    if (res.kind === "HELP") expect(res.reply.toLowerCase()).toContain("status");
    const cnt = await db.query(`SELECT COUNT(*)::int AS n FROM tickets WHERE bank_id = $1`, [ids.bankA]);
    expect((cnt.rows[0] as { n: number }).n).toBe(0);
  });

  it("NOTIF-003: opt-out WHATSAPP existant NON réactivé par un inbound (ON CONFLICT DO NOTHING)", async () => {
    await insertConsentWhatsApp(ids.bankA, { optedIn: false, revoked: true });
    await processInboundMessage({ from: PHONE, text: "1", providerMessageId: "wamid-noreact" }, inboundDeps(ids.bankA, ids.agencyA, ids.queueA));
    const c = await db.query(
      `SELECT opted_in, revoked_at FROM notification_consents WHERE bank_id = $1 AND phone_hash = $2 AND channel = 'WHATSAPP'`,
      [ids.bankA, PHONE_HASH]
    );
    const row = c.rows[0] as { opted_in: boolean; revoked_at: string | null };
    expect(row.opted_in).toBe(false); // non réactivé.
    expect(row.revoked_at).not.toBeNull();
  });
});

describe("NOTIF-003 — webhook HTTP entrant (route)", () => {
  const WEBHOOK_SECRET = "wa-secret";

  /** Monte le routeur entrant seul avec la connexion live injectée en contexte. */
  function mountRouter(): Hono<{ Variables: { db: unknown; redis: unknown; bus: unknown } }> {
    const app = new Hono<{ Variables: { db: unknown; redis: unknown; bus: unknown } }>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("redis", {});
      c.set("bus", createNoopBus());
      await next();
    });
    app.route("/api/v1", createWhatsAppInboundRouter() as unknown as Hono);
    return app;
  }

  function sign(body: string): string {
    return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
  }

  function inboundPayload(text: string, id: string): string {
    return JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        { id: "acc", changes: [{ value: { messaging_product: "whatsapp", messages: [{ from: "+2250700000099", id, type: "text", text: { body: text } }] } }] },
      ],
    });
  }

  beforeEach(async () => {
    // Config WhatsApp de bank A (secret + agence + mapping menu C4).
    await db.query(
      `INSERT INTO whatsapp_config (bank_id, business_number, webhook_secret, default_agency_id)
       VALUES ($1, '+2252700000001', $2, $3)
       ON CONFLICT (bank_id) DO UPDATE SET webhook_secret = EXCLUDED.webhook_secret, default_agency_id = EXCLUDED.default_agency_id`,
      [ids.bankA, WEBHOOK_SECRET, ids.agencyA]
    );
    await db.query(`DELETE FROM whatsapp_menu_mapping WHERE bank_id = $1`, [ids.bankA]);
    await db.query(
      `INSERT INTO whatsapp_menu_mapping (bank_id, keyword, service_id) VALUES ($1, '1', $2)`,
      [ids.bankA, SERVICE]
    );
  });

  it("NOTIF-003: resolveWhatsAppConfig — slug connu → config ; slug inconnu → null", async () => {
    const ok = await resolveWhatsAppConfig(db as never, "a");
    expect(ok).not.toBeNull();
    expect(ok?.bankId).toBe(ids.bankA);
    expect(ok?.menuMapping).toEqual([{ keyword: "1", serviceId: SERVICE }]);
    expect(await resolveWhatsAppConfig(db as never, "does-not-exist")).toBeNull();
  });

  it("NOTIF-003: HTTP bankSlug inconnu → 404 opaque, aucun ticket", async () => {
    const app = mountRouter();
    const body = inboundPayload("1", "wamid-http-unknown");
    const res = await app.request("/api/v1/webhooks/whatsapp/inbound/unknown-bank", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
      body,
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("BANK_NOT_FOUND");
  });

  it("NOTIF-003: HTTP signature invalide → 401, aucun traitement", async () => {
    const app = mountRouter();
    const body = inboundPayload("1", "wamid-http-badsig");
    const res = await app.request("/api/v1/webhooks/whatsapp/inbound/a", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
      body,
    });
    expect(res.status).toBe(401);
    const before = await db.query(`SELECT COUNT(*)::int AS n FROM whatsapp_inbound_messages`);
    expect((before.rows[0] as { n: number }).n).toBe(0);
  });

  it("NOTIF-003: HTTP signature absente → 401", async () => {
    const app = mountRouter();
    const body = inboundPayload("1", "wamid-http-nosig");
    const res = await app.request("/api/v1/webhooks/whatsapp/inbound/a", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("NOTIF-003: HTTP payload sans message texte → 200 neutre (accusé Meta)", async () => {
    const app = mountRouter();
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id: "x" }] } }] }] });
    const res = await app.request("/api/v1/webhooks/whatsapp/inbound/a", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
      body,
    });
    expect(res.status).toBe(200);
  });

  it("NOTIF-003: HTTP intention ambiguë → 200, aucun ticket créé", async () => {
    const app = mountRouter();
    const body = inboundPayload("bonjour", "wamid-http-help");
    const res = await app.request("/api/v1/webhooks/whatsapp/inbound/a", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
      body,
    });
    expect(res.status).toBe(200);
    const cnt = await db.query(`SELECT COUNT(*)::int AS n FROM tickets WHERE bank_id = $1`, [ids.bankA]);
    expect((cnt.rows[0] as { n: number }).n).toBe(0);
    // Idempotence : le message a bien été réclamé (traité une fois).
    const claimed = await db.query(`SELECT COUNT(*)::int AS n FROM whatsapp_inbound_messages WHERE bank_id = $1`, [ids.bankA]);
    expect((claimed.rows[0] as { n: number }).n).toBe(1);
  });

  it("NOTIF-003: HTTP corps JSON invalide (signé) → 400", async () => {
    const app = mountRouter();
    const body = "{ not json";
    const res = await app.request("/api/v1/webhooks/whatsapp/inbound/a", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
      body,
    });
    expect(res.status).toBe(400);
  });
});
