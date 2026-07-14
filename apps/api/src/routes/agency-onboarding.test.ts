/**
 * Tests d'intégration — onboarding agence < 2h ADM-002a (admin.yaml, PG16 + Redis).
 *
 * Couvre (critères d'acceptation ADM-002a) :
 *  - clone crée l'agence + config (services/guichets/horaires), ZÉRO ticket/PII ;
 *  - clone sans templateId ni sourceAgencyId → 422 CLONE_SOURCE_REQUIRED ;
 *  - clone d'une source d'un AUTRE tenant → 404 opaque (tenant-isolation) ;
 *  - onboarding matérialise 5 étapes horodatées, récupérables via GET ;
 *  - kiosks:provision → enrollmentToken opaque + QR + expiresAt (défaut 60 min) ;
 *  - enrôlement consomme/invalide le token (rejeu → KIOSK_ENROLLMENT_INVALID) ;
 *  - le token d'enrôlement est ABSENT des logs (scrub).
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createApp } from "src/app.js";
import {
  startAdminHarness,
  stopAdminHarness,
  forgeToken,
  seedBankAgency,
  type AdminHarness,
  type BankFixture,
} from "src/routes/admin-test-harness.js";
import {
  RedisEnrollmentTokenStore,
} from "src/services/onboarding-stores.js";
import { consumeEnrollmentToken, EnrollmentInvalidError } from "src/lib/enrollment-token.js";

let h: AdminHarness;
let app: ReturnType<typeof createApp>;
let bankA: BankFixture;
let bankB: BankFixture;
let adminToken: string;
let dirToken: string;
let sourceAgencyId: string;

async function req(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function seedSourceConfig(): Promise<void> {
  sourceAgencyId = bankA.agencyId;
  await h.db.query(`UPDATE agencies SET weekly_schedule=$2::jsonb WHERE id=$1`, [
    sourceAgencyId,
    JSON.stringify({ monday: { start: "08:00", end: "17:00" } }),
  ]);
  const svc1 = await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes, is_active) VALUES ($1,$2,'DE','Dépôt',12,true) RETURNING id`,
    [bankA.bankId, sourceAgencyId]
  );
  await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name, is_active) VALUES ($1,$2,'RE','Retrait',true)`,
    [bankA.bankId, sourceAgencyId]
  );
  await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name, is_active) VALUES ($1,$2,'XX','Inactif',false)`,
    [bankA.bankId, sourceAgencyId]
  );
  const cnt = await h.db.query(
    `INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,1,'G1') RETURNING id`,
    [bankA.bankId, sourceAgencyId]
  );
  await h.db.query(
    `INSERT INTO counter_services (bank_id, counter_id, service_id) VALUES ($1,$2,$3)`,
    [bankA.bankId, (cnt.rows[0] as { id: string }).id, (svc1.rows[0] as { id: string }).id]
  );
  // Données à NE JAMAIS cloner : une file + un ticket avec un téléphone (PII).
  const q = await h.db.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
    [bankA.bankId, sourceAgencyId, (svc1.rows[0] as { id: string }).id]
  );
  await h.db.query(
    // Schéma FIDÈLE : `tickets.tracking_id` (char(21) UNIQUE) et `channel` NOT NULL sans défaut.
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, phone_encrypted, tracking_id, channel) VALUES ($1,$2,$3,$4,1,'ENC_PHONE','trkAgencyOnbOpen00001','KIOSK')`,
    [bankA.bankId, sourceAgencyId, (q.rows[0] as { id: string }).id, (svc1.rows[0] as { id: string }).id]
  );
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "adm002-a");
  bankB = await seedBankAgency(h.db, "adm002-b");
  adminToken = await forgeToken(h.jwtSecretBytes, "BANK_ADMIN", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  dirToken = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  await seedSourceConfig();
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("ADM-002a: clone structurel + onboarding", () => {
  it("ADM-002a: clone crée agence avec services/guichets/horaires, zéro ticket/PII copié", async () => {
    const res = await req("POST", `/banks/${bankA.bankId}/agencies:clone`, adminToken, {
      name: "Agence Marcory",
      sourceAgencyId,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { agencyId: string; onboardingId: string; createdAt: string };
    expect(body.agencyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.onboardingId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(body.createdAt).getTime()).toBeGreaterThan(0);

    // Nom + services ACTIFS clonés (2, pas l'inactif), SLA préservé.
    const ag = await h.db.query(`SELECT name, weekly_schedule FROM agencies WHERE id=$1`, [body.agencyId]);
    expect((ag.rows[0] as { name: string }).name).toBe("Agence Marcory");
    expect((ag.rows[0] as { weekly_schedule: Record<string, unknown> }).weekly_schedule["monday"]).toBeDefined();
    const svc = await h.db.query(
      `SELECT code, sla_minutes FROM services WHERE agency_id=$1 AND deleted_at IS NULL ORDER BY code`,
      [body.agencyId]
    );
    expect((svc.rows as Array<{ code: string }>).map((r) => r.code)).toEqual(["DE", "RE"]);
    expect((svc.rows[0] as { sla_minutes: number }).sla_minutes).toBe(12);

    // Guichet CLOSED + counter_services clonés.
    const cnt = await h.db.query(`SELECT id, status FROM counters WHERE agency_id=$1`, [body.agencyId]);
    expect(cnt.rows).toHaveLength(1);
    expect((cnt.rows[0] as { status: string }).status).toBe("CLOSED");
    const links = await h.db.query(`SELECT 1 FROM counter_services WHERE counter_id=$1`, [
      (cnt.rows[0] as { id: string }).id,
    ]);
    expect(links.rows).toHaveLength(1);

    // ZÉRO ticket / file / PII sur la cible.
    const tickets = await h.db.query(`SELECT count(*)::int AS n FROM tickets WHERE agency_id=$1`, [body.agencyId]);
    expect((tickets.rows[0] as { n: number }).n).toBe(0);
    const queues = await h.db.query(`SELECT count(*)::int AS n FROM queues WHERE agency_id=$1`, [body.agencyId]);
    expect((queues.rows[0] as { n: number }).n).toBe(0);
  });

  it("ADM-002a: onboarding matérialise 5 étapes horodatées récupérables via GET", async () => {
    const clone = await req("POST", `/banks/${bankA.bankId}/agencies:clone`, adminToken, {
      name: "Agence Cocody",
      sourceAgencyId,
    });
    const { agencyId, onboardingId } = (await clone.json()) as {
      agencyId: string;
      onboardingId: string;
    };
    const res = await req("GET", `/agencies/${agencyId}/onboarding/${onboardingId}`, adminToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      onboardingId: string;
      agencyId: string;
      steps: Array<{ key: string; status: string; completedAt: string | null }>;
      startedAt: string;
      completedAt: string | null;
    };
    expect(body.onboardingId).toBe(onboardingId);
    expect(body.agencyId).toBe(agencyId);
    expect(body.steps).toHaveLength(5);
    // 3 étapes structurelles DONE + horodatées après le clone.
    const done = body.steps.filter((s) => s.status === "DONE");
    expect(done.length).toBeGreaterThanOrEqual(3);
    expect(done.every((s) => typeof s.completedAt === "string")).toBe(true);
    expect(new Date(body.startedAt).getTime()).toBeGreaterThan(0);
  });

  it("ADM-002a: clone sans templateId ni sourceAgencyId → 422 CLONE_SOURCE_REQUIRED", async () => {
    const res = await req("POST", `/banks/${bankA.bankId}/agencies:clone`, adminToken, {
      name: "Sans source",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CLONE_SOURCE_REQUIRED");
  });

  it("ADM-002a: clone avec templateId ET sourceAgencyId → 422 CLONE_SOURCE_REQUIRED (ambigu)", async () => {
    const res = await req("POST", `/banks/${bankA.bankId}/agencies:clone`, adminToken, {
      name: "Deux sources",
      templateId: sourceAgencyId,
      sourceAgencyId,
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CLONE_SOURCE_REQUIRED");
  });

  it("ADM-002a: clone d'une source d'un AUTRE tenant → 404 opaque (tenant-isolation)", async () => {
    // La source appartient à bankB ; le JWT est scopé bankA → 404 opaque.
    const res = await req("POST", `/banks/${bankA.bankId}/agencies:clone`, adminToken, {
      name: "Vol cross-tenant",
      sourceAgencyId: bankB.agencyId,
    });
    expect(res.status).toBe(404);
    // Aucune agence bankB clonée dans bankA.
    const leaked = await h.db.query(
      `SELECT count(*)::int AS n FROM agencies WHERE bank_id=$1 AND name='Vol cross-tenant'`,
      [bankA.bankId]
    );
    expect((leaked.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("ADM-002a: provisioning borne + jeton d'enrôlement", () => {
  it("ADM-002a: kiosks:provision → enrollmentToken opaque + QR + expiresAt (défaut 60 min)", async () => {
    const before = Date.now();
    const res = await req("POST", `/agencies/${bankA.agencyId}/kiosks:provision`, dirToken);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      kioskId: string;
      enrollmentToken: string;
      enrollmentQrUrl: string;
      expiresAt: string;
    };
    expect(body.kioskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.enrollmentToken).toMatch(/^enr_/);
    // Le QR encode l'URL d'enrôlement (kioskId), JAMAIS le token en clair.
    expect(body.enrollmentQrUrl).toContain(`/enroll/${body.kioskId}`);
    expect(body.enrollmentQrUrl).not.toContain(body.enrollmentToken);
    // TTL défaut 60 min (± quelques secondes).
    const ttlMs = new Date(body.expiresAt).getTime() - before;
    expect(ttlMs).toBeGreaterThan(59 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(61 * 60_000);
    // La borne existe en base.
    const k = await h.db.query(`SELECT count(*)::int AS n FROM kiosks WHERE id=$1`, [body.kioskId]);
    expect((k.rows[0] as { n: number }).n).toBe(1);
  });

  it("ADM-002a: enrôlement consomme/invalide le token (rejeu → KIOSK_ENROLLMENT_INVALID)", async () => {
    const res = await req("POST", `/agencies/${bankA.agencyId}/kiosks:provision`, dirToken);
    const { enrollmentToken, kioskId } = (await res.json()) as {
      enrollmentToken: string;
      kioskId: string;
    };
    const store = new RedisEnrollmentTokenStore(h.redis);
    // 1er échange : réussit, résout le binding.
    const binding = await consumeEnrollmentToken(store, enrollmentToken, { bankId: bankA.bankId });
    expect(binding.kioskId).toBe(kioskId);
    expect(binding.agencyId).toBe(bankA.agencyId);
    // Rejeu : refus opaque (usage unique).
    await expect(
      consumeEnrollmentToken(store, enrollmentToken, { bankId: bankA.bankId })
    ).rejects.toBeInstanceOf(EnrollmentInvalidError);
  });

  it("ADM-002a: enrôlement avec token d'un AUTRE tenant → opaque, indistinct", async () => {
    const res = await req("POST", `/agencies/${bankA.agencyId}/kiosks:provision`, dirToken);
    const { enrollmentToken } = (await res.json()) as { enrollmentToken: string };
    const store = new RedisEnrollmentTokenStore(h.redis);
    await expect(
      consumeEnrollmentToken(store, enrollmentToken, { bankId: bankB.bankId })
    ).rejects.toBeInstanceOf(EnrollmentInvalidError);
  });

  it("ADM-002a: provisioning hors scope agence (AGENCY_DIRECTOR) → 403", async () => {
    // Directeur de bankA tentant de provisionner une borne de l'agence de bankB.
    const res = await req("POST", `/agencies/${bankB.agencyId}/kiosks:provision`, dirToken);
    expect([403, 404]).toContain(res.status);
  });

  it("ADM-002a: le enrollmentToken est ABSENT des logs (scrub de log)", async () => {
    // Capture tout ce qui est écrit sur stdout (Pino) pendant le provisioning.
    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown): boolean => {
        chunks.push(String(chunk));
        return true;
      });
    let token: string;
    try {
      const res = await req("POST", `/agencies/${bankA.agencyId}/kiosks:provision`, dirToken);
      token = ((await res.json()) as { enrollmentToken: string }).enrollmentToken;
    } finally {
      spy.mockRestore();
    }
    const logged = chunks.join("");
    expect(token).toMatch(/^enr_/);
    // Le token clair n'apparaît JAMAIS dans les logs.
    expect(logged).not.toContain(token);
  });
});
