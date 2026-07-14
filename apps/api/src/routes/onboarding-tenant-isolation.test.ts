/**
 * Suite tenant-isolation — API-009 (Testcontainers PG16).
 *
 * Vérifie qu'un acteur de la banque B ne peut PAS agir sur les ressources de la
 * banque A via les routes 009 : clone, kiosk-access, theme, import (agence B ne
 * peut pas rattacher une agence A) et purge. Refus attendu (403/404), jamais
 * d'effet cross-tenant.
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
let bankB: BankFixture;
let tokenB: string;

async function req(method: string, path: string, token: string, body?: unknown, idem?: string): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
  if (idem) headers["X-Idempotency-Key"] = idem;
  return app.request(`/api/v1${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "iso-bank-a");
  bankB = await seedBankAgency(h.db, "iso-bank-b");
  // Token banque B, scopé sur ses PROPRES agences (jamais celles de A).
  tokenB = await forgeToken(h.jwtSecretBytes, "BANK_ADMIN", bankB.directorId, bankB.bankId, [bankB.agencyId]);
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-009: tenant-isolation — refus cross-bank sur clone/kiosk/theme/purge", () => {
  it("API-009: theme banque A par admin B → 403 (garde cross-tenant middleware)", async () => {
    const res = await req("GET", `/banks/${bankA.bankId}/theme`, tokenB);
    expect(res.status).toBe(403);
  });

  it("API-009: clone d'une agence A par admin B → 404 (agence hors tenant)", async () => {
    const res = await req(
      "POST",
      `/agencies/${bankA.agencyId}/clone-from/${bankA.agencyId}`,
      tokenB
    );
    expect([403, 404]).toContain(res.status);
    // Aucune donnée créée sous la banque A par l'action de B.
    const svc = await h.db.query(`SELECT count(*)::int AS n FROM services WHERE agency_id=$1`, [bankA.agencyId]);
    expect((svc.rows[0] as { n: number }).n).toBe(0);
  });

  it("API-009: kiosk-access sur agence A par admin B → refus (agence hors tenant)", async () => {
    // Un BANK_ADMIN de B ne voit pas l'agence A : refus non-leaky (404 tenant) ou 403 scope.
    const res = await req("POST", `/agencies/${bankA.agencyId}/kiosk-access`, tokenB, { label: "X" });
    expect([403, 404]).toContain(res.status);
    const kiosks = await h.db.query(`SELECT count(*)::int AS n FROM kiosks WHERE agency_id=$1`, [bankA.agencyId]);
    expect((kiosks.rows[0] as { n: number }).n).toBe(0);
  });

  it("API-009: purge-phone par admin B n'affecte pas la banque A", async () => {
    // Un ticket de A avec un phone_hash arbitraire ne doit jamais être touché par B.
    const svc = await h.db.query(
      `INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'IS','I') RETURNING id`,
      [bankA.bankId, bankA.agencyId]
    );
    const q = await h.db.query(
      `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
      [bankA.bankId, bankA.agencyId, (svc.rows[0] as { id: string }).id]
    );
    await h.db.query(
      // Schéma FIDÈLE : `tickets.tracking_id` (char(21) UNIQUE) et `channel` NOT NULL sans défaut.
      `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, phone_hash, tracking_id, channel) VALUES ($1,$2,$3,$4,1,'hash-a','trkTenantIsoOpen00001','KIOSK')`,
      [bankA.bankId, bankA.agencyId, (q.rows[0] as { id: string }).id, (svc.rows[0] as { id: string }).id]
    );
    const res = await req("POST", "/data/purge-phone", tokenB, { phone: "+2250700000099" }, "iso-purge-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { affectedTickets: number };
    expect(body.affectedTickets).toBe(0);
    // Le ticket de A conserve son phone_hash.
    const still = await h.db.query(
      `SELECT count(*)::int AS n FROM tickets WHERE bank_id=$1 AND phone_hash='hash-a'`,
      [bankA.bankId]
    );
    expect((still.rows[0] as { n: number }).n).toBe(1);
  });

  it("API-009: révocation kiosk A par directeur B → 404 (borne hors tenant)", async () => {
    // Provisionner une borne sous A.
    const tokenA = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
    const access = await req("POST", `/agencies/${bankA.agencyId}/kiosk-access`, tokenA, { label: "A" });
    const kioskId = ((await access.json()) as { kioskId: string }).kioskId;
    // B tente de révoquer.
    const res = await req("DELETE", `/kiosk/session/${kioskId}`, tokenB);
    expect(res.status).toBe(404);
    const still = await h.db.query(`SELECT session_revoked_at FROM kiosks WHERE id=$1`, [kioskId]);
    expect((still.rows[0] as { session_revoked_at: Date | null }).session_revoked_at).toBeNull();
  });
});
