/**
 * Tests d'intégration — droit à l'oubli API-009 (admin.yaml, Testcontainers PG16).
 *
 * Couvre : purge-phone → {purged:true, affectedTickets} puis {purged:false} +
 * entrée audit DATA_PURGE (bout-en-bout) ; X-Idempotency-Key absent → 400 ;
 * retention-policy défaut 13 mois.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "src/app.js";
import { hashPhone } from "src/lib/phone-cipher.js";
import {
  startAdminHarness,
  stopAdminHarness,
  forgeToken,
  seedBankAgency,
  type AdminHarness,
  type BankFixture,
} from "src/routes/admin-test-harness.js";

let h: AdminHarness;
let app: ReturnType<typeof createApp>;
let bankA: BankFixture;
let adminToken: string;

const PURGE_PHONE = "+2250700000099";

async function req(method: string, path: string, token: string, body?: unknown, idem?: string): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
  if (idem) headers["X-Idempotency-Key"] = idem;
  return app.request(`/api/v1${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Seed 3 tickets portant le phone_hash du numéro à purger. */
async function seedPurgeableTickets(): Promise<void> {
  const svc = await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'PU','P') RETURNING id`,
    [bankA.bankId, bankA.agencyId]
  );
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await h.db.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
    [bankA.bankId, bankA.agencyId, serviceId]
  );
  const queueId = (q.rows[0] as { id: string }).id;
  const phoneHash = hashPhone(PURGE_PHONE);
  for (let i = 0; i < 3; i += 1) {
    await h.db.query(
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, phone_hash, phone_encrypted, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'v1:x:y:z', now())`,
      [bankA.bankId, bankA.agencyId, queueId, serviceId, i + 1, phoneHash]
    );
  }
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "priv-bank-a");
  adminToken = await forgeToken(h.jwtSecretBytes, "BANK_ADMIN", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  await seedPurgeableTickets();
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-009: purge-phone idempotent + audit DATA_PURGE", () => {
  it("API-009: purge-phone → {purged:true, affectedTickets} puis {purged:false} + audit DATA_PURGE", async () => {
    const first = await req("POST", "/data/purge-phone", adminToken, { phone: PURGE_PHONE }, "idem-1");
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { purged: boolean; affectedTickets: number };
    expect(firstBody.purged).toBe(true);
    expect(firstBody.affectedTickets).toBe(3);

    // Entrée audit DATA_PURGE écrite (sans PII).
    const audit = await h.db.query(
      `SELECT action, diff FROM audit_log WHERE bank_id=$1 AND action='DATA_PURGE'`,
      [bankA.bankId]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);

    // Second appel → idempotence.
    const second = await req("POST", "/data/purge-phone", adminToken, { phone: PURGE_PHONE }, "idem-2");
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { purged: boolean; affectedTickets: number };
    expect(secondBody.purged).toBe(false);
    expect(secondBody.affectedTickets).toBe(0);

    // Les phone_hash ont bien été anonymisés (NULL).
    const remaining = await h.db.query(
      `SELECT count(*)::int AS n FROM tickets WHERE bank_id=$1 AND phone_hash=$2`,
      [bankA.bankId, hashPhone(PURGE_PHONE)]
    );
    expect((remaining.rows[0] as { n: number }).n).toBe(0);
  });

  it("API-009: X-Idempotency-Key absent → 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const res = await req("POST", "/data/purge-phone", adminToken, { phone: PURGE_PHONE });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("API-009: retention-policy → 13 mois par défaut", async () => {
    const res = await req("GET", "/data/retention-policy", adminToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { retentionMonths: number; purgeSchedule: string };
    expect(body.retentionMonths).toBe(13);
    expect(body.purgeSchedule).toBe("daily");
  });
});
