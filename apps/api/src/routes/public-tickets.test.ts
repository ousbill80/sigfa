/**
 * Tests d'intégration — routes publiques feedback & suivi (API-010).
 *
 * PostgreSQL 16 + Redis 7 réels (Testcontainers). Aucune authentification :
 * ces routes sont PUBLIQUES (sans JWT). L'horloge de la fenêtre 24 h est
 * contrôlée via un `closed_at` paramétré en base.
 *
 * Critères EARS couverts :
 * - `API-010: fenêtre 24 h UTC strict — T+23h59 → autorisé ; T+24h00 → 422`
 * - `API-010: happy path + les 3 codes d'erreur de fenêtre/doublon`
 * - `API-010: trackingId inconnu ET malformé → 404 indistinguables`
 * - `API-010: 6e feedback/min même IP → 429 ; suivi caché 30s (headers)`
 * - `API-010: commentaire avec HTML/contrôles → nettoyé/rejeté`
 * - `API-010: NPS — 5→promoter, 4→passive, 3→detractor une seule fois par ticket`
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { nanoid } from "nanoid";
import { applyMigrations } from "@sigfa/database/test-support";
import type { PostgresHarness } from "@sigfa/testing/tenant-isolation";
import { createApp } from "src/app.js";

process.env["PHONE_ENCRYPTION_KEY"] =
  process.env["PHONE_ENCRYPTION_KEY"] ??
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env["PHONE_HASH_KEY"] =
  process.env["PHONE_HASH_KEY"] ??
  "2222222222222222222222222222222222222222222222222222222222222222";

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: pg.Client;
let redis: Redis;
let app: ReturnType<typeof createApp>;
let bankId: string;
let agencyId: string;
let serviceId: string;
let queueId: string;

const jwtSecretBytes = new TextEncoder().encode("public-feedback-secret-32-chars-long!!");

/**
 * Applique les VRAIES migrations SQL (`packages/database/migrations/`) sur la base
 * de test — FIDÉLITÉ au schéma de production (même convention que
 * `schemathesis-public.test.ts` / `armed-tenant.integration.test.ts`). Le drift
 * harnais/schéma est structurellement impossible : le schéma exercé EST celui des
 * migrations. En particulier `tickets.required_language` (enum `agent_language`
 * FR/EN, migrations 0008+0011), la RLS `tenant_isolation` (ENABLE/FORCE + policies,
 * 0001), le vrai `audit_log` (0003) et l'unicité `(queue_id, number, issued_day)`
 * sont présents — un DDL inline les omettait ou les typait faux, masquant des bugs.
 *
 * La connexion applicative est le rôle `sigfa` (superuser Testcontainers) : il
 * contourne FORCE RLS, donc les lookups PRÉ-TENANT légitimes de la surface publique
 * (résolution du ticket par `tracking_id` global, du bankId de l'agence) restent
 * fonctionnels — comme en production sur le chemin pré-résolution. L'isolation RLS
 * armée POST-résolution est prouvée séparément par
 * `config-cutover-lot7-tenant-isolation.integration.test.ts` (connexion `sigfa_app`
 * NOBYPASSRLS), hors périmètre de ce test fonctionnel de route.
 */
async function runMigrations(client: pg.Client): Promise<void> {
  const harness: PostgresHarness = {
    connectionString: "",
    query: async (sql: string, values?: unknown[]) => {
      const res =
        values !== undefined ? await client.query(sql, values) : await client.query(sql);
      return { rows: res.rows as Array<Record<string, unknown>> };
    },
    stop: async () => {},
  };
  await applyMigrations(harness);
}

/** Compteur monotone : garantit un `number` distinct par ticket (contrainte réelle
 * `tickets_queue_id_number_issued_day_key` UNIQUE(queue_id, number, issued_day) —
 * absente du DDL inline qui réutilisait `number=1`, ce qui aurait échoué en prod). */
let ticketSeq = 0;

/**
 * Insère un ticket clôturé (DONE) avec un `closed_at` contrôlé.
 * @returns trackingId du ticket créé
 */
async function seedClosedTicket(closedAt: Date | null, status = "DONE"): Promise<string> {
  const trackingId = nanoid(21);
  ticketSeq += 1;
  const number = ticketSeq;
  await db.query(
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, display_number, tracking_id, channel, status, closed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'KIOSK',$8,$9)`,
    [bankId, agencyId, queueId, serviceId, number, `OC-${String(number).padStart(3, "0")}`, trackingId, status, closedAt]
  );
  return trackingId;
}

/** POST feedback avec IP simulée via X-Forwarded-For. */
async function postFeedback(trackingId: string, body: unknown, ip = "10.0.0.1"): Promise<Response> {
  return app.request(`/api/v1/public/tickets/${trackingId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
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
  await runMigrations(db);
  redis = new Redis(`redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`);

  const bank = await db.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  bankId = (bank.rows[0] as { id: string }).id;
  const agency = await db.query(`INSERT INTO agencies (bank_id, name) VALUES ($1,'A') RETURNING id`, [bankId]);
  agencyId = (agency.rows[0] as { id: string }).id;
  const svc = await db.query(`INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'OC','Ouverture') RETURNING id`, [bankId, agencyId]);
  serviceId = (svc.rows[0] as { id: string }).id;
  const q = await db.query(`INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`, [bankId, agencyId, serviceId]);
  queueId = (q.rows[0] as { id: string }).id;

  app = createApp({ db, redis, jwtSecret: jwtSecretBytes });
}, 180_000);

afterAll(async () => {
  await redis.quit();
  await db.end();
  await pgContainer.stop();
  await redisContainer.stop();
}, 30_000);

beforeEach(async () => {
  await redis.flushall();
});

// ── Happy path + fenêtre + codes d'erreur ────────────────────────────────────

describe("API-010: happy path + les 3 codes d'erreur de fenêtre/doublon (horloge contrôlée)", () => {
  it("API-010: happy path — note 4 → 201 sans PII ni uuid interne", async () => {
    const tid = await seedClosedTicket(new Date());
    const res = await postFeedback(tid, { note: 4, comment: "Rapide et pro" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    // Aucun uuid interne ni PII dans la réponse
    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("API-010: ticket non clôturé (WAITING) → 422 TICKET_NOT_CLOSED", async () => {
    const tid = await seedClosedTicket(null, "WAITING");
    const res = await postFeedback(tid, { note: 5 });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TICKET_NOT_CLOSED");
  });

  it("API-010: feedback déjà soumis → 409 FEEDBACK_ALREADY_SUBMITTED", async () => {
    const tid = await seedClosedTicket(new Date());
    expect((await postFeedback(tid, { note: 5 })).status).toBe(201);
    const res = await postFeedback(tid, { note: 3 }, "10.0.0.2");
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FEEDBACK_ALREADY_SUBMITTED");
  });

  it("API-010: fenêtre 24h UTC strict — T+23h59 → 201 autorisé", async () => {
    const closedAt = new Date(Date.now() - (23 * 60 + 59) * 60 * 1000);
    const tid = await seedClosedTicket(closedAt);
    const res = await postFeedback(tid, { note: 5 });
    expect(res.status).toBe(201);
  });

  it("API-010: fenêtre 24h UTC strict — T+24h01 → 422 FEEDBACK_WINDOW_EXPIRED", async () => {
    const closedAt = new Date(Date.now() - (24 * 60 + 1) * 60 * 1000);
    const tid = await seedClosedTicket(closedAt);
    const res = await postFeedback(tid, { note: 5 });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FEEDBACK_WINDOW_EXPIRED");
  });

  it("API-010: note hors bornes (0 ou 6) → 400 VALIDATION_ERROR", async () => {
    const tid = await seedClosedTicket(new Date());
    expect((await postFeedback(tid, { note: 0 })).status).toBe(400);
    expect((await postFeedback(tid, { note: 6 }, "10.0.0.3")).status).toBe(400);
  });
});

// ── Anti-énumération ─────────────────────────────────────────────────────────

describe("API-010: trackingId inconnu ET malformé → 404 indistinguables (anti-énumération)", () => {
  it("API-010: trackingId inconnu (bien formé) → 404 opaque", async () => {
    const unknownWellFormed = nanoid(21);
    const res = await postFeedback(unknownWellFormed, { note: 5 });
    expect(res.status).toBe(404);
    return res.json().then((b) => {
      expect((b as { error: { code: string } }).error.code).toBe("TICKET_NOT_FOUND");
    });
  });

  it("API-010: trackingId malformé → 404 IDENTIQUE à l'inconnu (aucun oracle)", async () => {
    const malformed = "not-a-valid-id!!";
    const resMalformed = await postFeedback(malformed, { note: 5 });
    const resUnknown = await postFeedback(nanoid(21), { note: 5 });
    expect(resMalformed.status).toBe(resUnknown.status);
    expect(resMalformed.status).toBe(404);
    const bMal = (await resMalformed.json()) as { error: { code: string; message: string } };
    const bUnk = (await resUnknown.json()) as { error: { code: string; message: string } };
    // Corps strictement identiques → aucun oracle d'énumération
    expect(bMal).toEqual(bUnk);
  });

  it("API-010: suivi GET trackingId malformé et inconnu → 404 indistinguables", async () => {
    const resMal = await app.request(`/api/v1/public/tickets/short`);
    const resUnk = await app.request(`/api/v1/public/tickets/${nanoid(21)}`);
    expect(resMal.status).toBe(404);
    expect(resUnk.status).toBe(404);
    expect(await resMal.json()).toEqual(await resUnk.json());
  });
});

// ── Suivi public : cache + pas d'uuid ────────────────────────────────────────

describe("API-010: suivi caché 30s (headers vérifiés) + zéro uuid interne", () => {
  it("API-010: GET suivi → 200 Cache-Control max-age=30 + ETag, sans uuid interne du ticket", async () => {
    const tid = await seedClosedTicket(new Date(), "WAITING");
    const res = await app.request(`/api/v1/public/tickets/${tid}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("max-age=30");
    expect(res.headers.get("etag")).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["trackingId"]).toBe(tid);
    // L'uuid interne du ticket ne doit JAMAIS apparaître
    expect(Object.keys(body)).not.toContain("id");
    const idRow = await db.query(`SELECT id FROM tickets WHERE tracking_id = $1`, [tid]);
    const internalId = (idRow.rows[0] as { id: string }).id;
    expect(JSON.stringify(body)).not.toContain(internalId);
  });
});

// ── Rate limit ───────────────────────────────────────────────────────────────

describe("API-010: 6e feedback/min même IP → 429 ; suivi 30 req/min", () => {
  it("API-010: 6e feedback dans la minute (même IP) → 429 + Retry-After", async () => {
    // 5 tickets distincts, même IP → le 6e appel doit dépasser la limite IP (5/min).
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) {
      const tid = await seedClosedTicket(new Date());
      last = await postFeedback(tid, { note: 5 }, "203.0.113.9");
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).toBeTruthy();
    const body = (await last!.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
  });
});

// ── NPS idempotence par ticket ───────────────────────────────────────────────

describe("API-010: NPS — 5→promoter, 4→passive, 3→detractor incrémentés une seule fois par ticket", () => {
  async function npsRow(): Promise<{ p: number; pa: number; d: number; fc: number }> {
    const res = await db.query(
      `SELECT nps_promoters, nps_passives, nps_detractors, feedback_count
         FROM daily_agency_stats WHERE bank_id=$1 AND agency_id=$2 AND service_id IS NULL`,
      [bankId, agencyId]
    );
    const r = res.rows[0] as { nps_promoters: number; nps_passives: number; nps_detractors: number; feedback_count: number } | undefined;
    return { p: r?.nps_promoters ?? 0, pa: r?.nps_passives ?? 0, d: r?.nps_detractors ?? 0, fc: r?.feedback_count ?? 0 };
  }

  it("API-010: note 5 → promoter +1, note 4 → passive +1, note 3 → detractor +1", async () => {
    await db.query(`DELETE FROM daily_agency_stats WHERE bank_id=$1`, [bankId]);
    const before = await npsRow();
    const t5 = await seedClosedTicket(new Date());
    const t4 = await seedClosedTicket(new Date());
    const t3 = await seedClosedTicket(new Date());
    expect((await postFeedback(t5, { note: 5 }, "10.1.0.1")).status).toBe(201);
    expect((await postFeedback(t4, { note: 4 }, "10.1.0.2")).status).toBe(201);
    expect((await postFeedback(t3, { note: 3 }, "10.1.0.3")).status).toBe(201);
    const after = await npsRow();
    expect(after.p - before.p).toBe(1);
    expect(after.pa - before.pa).toBe(1);
    expect(after.d - before.d).toBe(1);
    expect(after.fc - before.fc).toBe(3);
  });

  it("API-010: rejeu (2e feedback même ticket) → pas de double comptage (idempotent par ticket)", async () => {
    await db.query(`DELETE FROM daily_agency_stats WHERE bank_id=$1`, [bankId]);
    const tid = await seedClosedTicket(new Date());
    expect((await postFeedback(tid, { note: 5 }, "10.2.0.1")).status).toBe(201);
    const afterFirst = await npsRow();
    // 2e tentative → 409, aucun incrément supplémentaire
    expect((await postFeedback(tid, { note: 5 }, "10.2.0.2")).status).toBe(409);
    const afterReplay = await npsRow();
    expect(afterReplay.p).toBe(afterFirst.p);
    expect(afterReplay.fc).toBe(afterFirst.fc);
  });
});

// ── Sanitation via la route ──────────────────────────────────────────────────

describe("API-010: commentaire avec HTML/contrôles → nettoyé/rejeté (via route)", () => {
  it("API-010: HTML dans le commentaire → nettoyé et stocké sans balises", async () => {
    const tid = await seedClosedTicket(new Date());
    const res = await postFeedback(tid, { note: 5, comment: "<b>Super</b> service" });
    expect(res.status).toBe(201);
    const row = await db.query(`SELECT feedback_comment FROM tickets WHERE tracking_id = $1`, [tid]);
    const stored = (row.rows[0] as { feedback_comment: string }).feedback_comment;
    expect(stored).toBe("Super service");
    expect(stored).not.toContain("<");
  });

  it("API-010: commentaire avec caractère de contrôle → 400 VALIDATION_ERROR", async () => {
    const tid = await seedClosedTicket(new Date());
    const res = await postFeedback(tid, { note: 5, comment: `malicieux${String.fromCharCode(0)}null` });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
