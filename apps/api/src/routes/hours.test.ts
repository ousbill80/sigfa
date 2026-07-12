/**
 * Tests d'intégration — routeur horaires d'agence API-008 (Testcontainers PG16).
 *
 * Couvre le critère EARS clé : une fermeture exceptionnelle (PATCH sans
 * weeklySchedule) n'écrase PAS l'hebdo. Plus : merge par jour, fériés en
 * lecture, audit, champ inconnu → 422, RBAC hors scope → 403.
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
let dirToken: string;

async function req(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "hrs-bank-a");
  dirToken = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  await h.db.query(`INSERT INTO public_holidays (date, name) VALUES ('2026-08-07','Fête Nationale')`);
  // Hebdo initial
  await h.db.query(
    `UPDATE agencies SET weekly_schedule=$2::jsonb WHERE id=$1`,
    [bankA.agencyId, JSON.stringify({ monday: { open: "08:00", close: "17:00", closed: false } })]
  );
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-008: horaires d'agence + merge + audit", () => {
  it("API-008: GET hours retourne hebdo + fériés CI (lecture)", async () => {
    const res = await req("GET", `/agencies/${bankA.agencyId}/hours`, dirToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { weeklySchedule: Record<string, unknown>; publicHolidaysCI: unknown[] };
    expect(body.weeklySchedule["monday"]).toBeDefined();
    expect(body.publicHolidaysCI.length).toBeGreaterThanOrEqual(1);
  });

  it("API-008: PATCH hours — fermeture exceptionnelle n'écrase PAS l'hebdo", async () => {
    const res = await req("PATCH", `/agencies/${bankA.agencyId}/hours`, dirToken, {
      exceptionalClosures: [{ date: "2026-03-15", reason: "Formation du personnel" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      weeklySchedule: Record<string, { open: string }>;
      exceptionalClosures: Array<{ date: string }>;
    };
    // L'hebdo (lundi 08:00-17:00) est PRÉSERVÉ
    expect(body.weeklySchedule["monday"]?.open).toBe("08:00");
    expect(body.exceptionalClosures).toHaveLength(1);
    expect(body.exceptionalClosures[0]?.date).toBe("2026-03-15");
  });

  it("API-008: PATCH hours — merge par jour préserve les jours non fournis", async () => {
    const res = await req("PATCH", `/agencies/${bankA.agencyId}/hours`, dirToken, {
      weeklySchedule: { saturday: { open: "09:00", close: "12:00", closed: false } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { weeklySchedule: Record<string, { open: string }> };
    expect(body.weeklySchedule["monday"]?.open).toBe("08:00"); // préservé
    expect(body.weeklySchedule["saturday"]?.open).toBe("09:00"); // ajouté
    const audit = await h.db.query(
      `SELECT 1 FROM audit_log WHERE action='PATCH /agencies/:id/hours' AND entity_id=$1`, [bankA.agencyId]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("API-008: PATCH hours — champ inconnu → 422", async () => {
    const res = await req("PATCH", `/agencies/${bankA.agencyId}/hours`, dirToken, { boom: true });
    expect(res.status).toBe(422);
  });

  it("API-008: RBAC — DIRECTOR hors scope agence → 403", async () => {
    const bankB = await seedBankAgency(h.db, "hrs-bank-b");
    const res = await req("GET", `/agencies/${bankB.agencyId}/hours`, dirToken);
    expect(res.status).toBe(403);
  });
});
