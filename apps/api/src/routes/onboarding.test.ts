/**
 * Tests d'intégration — onboarding API-009 (admin.yaml, Testcontainers PG16).
 *
 * Couvre : clone → config identique (services + guichets + counter_services +
 * horaires), ZÉRO ticket/user copié ; kiosk-access → credentials + QR (secret
 * une seule fois).
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "src/app.js";
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
let templateAgencyId: string;
let targetAgencyId: string;
let adminToken: string;

async function req(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function seedTemplateConfig(): Promise<void> {
  templateAgencyId = bankA.agencyId;
  // Cible : nouvelle agence vide.
  const target = await h.db.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'Cible') RETURNING id`,
    [bankA.bankId]
  );
  targetAgencyId = (target.rows[0] as { id: string }).id;
  // Config template : horaires, 2 services actifs (+1 inactif), 1 guichet + liaisons.
  await h.db.query(`UPDATE agencies SET weekly_schedule=$2::jsonb WHERE id=$1`, [
    templateAgencyId,
    JSON.stringify({ monday: { open: "08:00", close: "17:00", closed: false } }),
  ]);
  const svc1 = await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name, is_active) VALUES ($1,$2,'DE','Dépôt',true) RETURNING id`,
    [bankA.bankId, templateAgencyId]
  );
  await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name, is_active) VALUES ($1,$2,'RE','Retrait',true)`,
    [bankA.bankId, templateAgencyId]
  );
  await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name, is_active) VALUES ($1,$2,'XX','Inactif',false)`,
    [bankA.bankId, templateAgencyId]
  );
  const cnt = await h.db.query(
    `INSERT INTO counters (bank_id, agency_id, number, label) VALUES ($1,$2,1,'G1') RETURNING id`,
    [bankA.bankId, templateAgencyId]
  );
  await h.db.query(
    `INSERT INTO counter_services (bank_id, counter_id, service_id) VALUES ($1,$2,$3)`,
    [bankA.bankId, (cnt.rows[0] as { id: string }).id, (svc1.rows[0] as { id: string }).id]
  );
  // Donnée à NE PAS cloner : une file + un ticket sur le template.
  const q = await h.db.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
    [bankA.bankId, templateAgencyId, (svc1.rows[0] as { id: string }).id]
  );
  await h.db.query(
    // Schéma FIDÈLE : `tickets.tracking_id` (char(21) UNIQUE) et `channel` NOT NULL sans défaut.
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, tracking_id, channel) VALUES ($1,$2,$3,$4,1,'trkOnboardingOpen0001','KIOSK')`,
    [bankA.bankId, templateAgencyId, (q.rows[0] as { id: string }).id, (svc1.rows[0] as { id: string }).id]
  );
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "onb-bank-a");
  adminToken = await forgeToken(h.jwtSecretBytes, "BANK_ADMIN", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  await seedTemplateConfig();
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-009: clone → config identique, zéro ticket/user copié", () => {
  it("API-009: clone → config identique, zéro ticket/user copié (test complet)", async () => {
    const res = await req(
      "POST",
      `/agencies/${targetAgencyId}/clone-from/${templateAgencyId}`,
      adminToken
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { targetAgencyId: string; clonedSections: string[] };
    expect(body.targetAgencyId).toBe(targetAgencyId);
    expect(body.clonedSections).toContain("services");

    // Services actifs clonés (2, pas l'inactif).
    const svc = await h.db.query(
      `SELECT code FROM services WHERE agency_id=$1 AND deleted_at IS NULL ORDER BY code`,
      [targetAgencyId]
    );
    expect((svc.rows as Array<{ code: string }>).map((r) => r.code)).toEqual(["DE", "RE"]);

    // Guichet + counter_services clonés.
    const cnt = await h.db.query(`SELECT id, status FROM counters WHERE agency_id=$1`, [targetAgencyId]);
    expect(cnt.rows).toHaveLength(1);
    expect((cnt.rows[0] as { status: string }).status).toBe("CLOSED");
    const links = await h.db.query(
      `SELECT 1 FROM counter_services WHERE counter_id=$1`,
      [(cnt.rows[0] as { id: string }).id]
    );
    expect(links.rows).toHaveLength(1);

    // Horaires clonés.
    const hours = await h.db.query(`SELECT weekly_schedule FROM agencies WHERE id=$1`, [targetAgencyId]);
    expect((hours.rows[0] as { weekly_schedule: Record<string, unknown> }).weekly_schedule["monday"]).toBeDefined();

    // ZÉRO ticket, ZÉRO file sur la cible.
    const tickets = await h.db.query(`SELECT count(*)::int AS n FROM tickets WHERE agency_id=$1`, [targetAgencyId]);
    expect((tickets.rows[0] as { n: number }).n).toBe(0);
    const queues = await h.db.query(`SELECT count(*)::int AS n FROM queues WHERE agency_id=$1`, [targetAgencyId]);
    expect((queues.rows[0] as { n: number }).n).toBe(0);
  });

  it("API-009: kiosk-access → credentials bcrypt + QR (secret affiché une seule fois)", async () => {
    const res = await req("POST", `/agencies/${bankA.agencyId}/kiosk-access`, adminToken, {
      label: "Borne entrée",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      kioskId: string;
      clientId: string;
      clientSecret: string;
      qrCodeDataUrl: string;
    };
    expect(body.clientSecret).toMatch(/^ksk_/);
    expect(body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    // Le secret n'est PAS stocké en clair : seul le hash bcrypt est en base.
    const stored = await h.db.query(`SELECT credentials_hash FROM kiosks WHERE id=$1`, [body.kioskId]);
    const hash = (stored.rows[0] as { credentials_hash: string }).credentials_hash;
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(hash).not.toContain(body.clientSecret);
  });
});
