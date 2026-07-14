/**
 * Tests d'intégration — routeur banques API-008 (Testcontainers PG16 réel).
 *
 * Couvre : liste platform, création + audit + 409 slug dupliqué, détail,
 * PATCH merge partiel + audit + diff, validation stricte (422), RBAC
 * (AUDITOR lecture seule → 403 sur mutation), tenant-isolation cross-bank.
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
let superToken: string;
let adminToken: string;
let auditorToken: string;

async function req(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-forwarded-for": "41.67.128.1",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "bank-a");
  superToken = await forgeToken(
    h.jwtSecretBytes,
    "SUPER_ADMIN",
    "00000000-0000-4000-a000-000000000000",
    null
  );
  adminToken = await forgeToken(
    h.jwtSecretBytes,
    "BANK_ADMIN",
    bankA.directorId,
    bankA.bankId,
    [bankA.agencyId]
  );
  auditorToken = await forgeToken(
    h.jwtSecretBytes,
    "AUDITOR",
    bankA.directorId,
    bankA.bankId,
    [bankA.agencyId]
  );
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-008: banques CRUD + RBAC + audit", () => {
  it("API-008: SUPER_ADMIN liste les banques (platform)", async () => {
    const res = await req("GET", "/banks", superToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; meta: { total: number } };
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it("API-008: SUPER_ADMIN crée une banque et une entrée audit est écrite avec diff", async () => {
    const res = await req("POST", "/banks", superToken, {
      name: "Banque Atlantique",
      slug: "baci",
    });
    expect(res.status).toBe(201);
    const bank = (await res.json()) as { id: string; slug: string; active: boolean };
    expect(bank.slug).toBe("baci");
    // Schéma FIDÈLE (migrations réelles) : le trigger DB `audit_change` sur `banks`
    // (0003) journalise AUSSI la mutation (`INSERT banks`). On cible donc PRÉCISÉMENT
    // l'entrée APPLICATIVE (`POST /banks`, entity_type `bank`), défense-en-profondeur.
    const audit = await h.db.query(
      `SELECT action, entity_type, diff FROM audit_log
         WHERE entity_id = $1 AND action = 'POST /banks'`,
      [bank.id]
    );
    expect(audit.rows).toHaveLength(1);
    const row = audit.rows[0] as { action: string; entity_type: string; diff: unknown };
    expect(row.action).toBe("POST /banks");
    expect(row.entity_type).toBe("bank");
    expect(row.diff).toMatchObject({ after: { slug: "baci" } });
  });

  it("API-008: création d'un slug dupliqué → 409 CONFLICT", async () => {
    const res = await req("POST", "/banks", superToken, {
      name: "Doublon",
      slug: "baci",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("API-008: champ inconnu → 422 UNPROCESSABLE_ENTITY (additionalProperties: false)", async () => {
    const res = await req("POST", "/banks", superToken, {
      name: "X",
      slug: "xbank",
      surprise: true,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNPROCESSABLE_ENTITY");
  });

  it("API-008: BANK_ADMIN obtient sa banque", async () => {
    const res = await req("GET", `/banks/${bankA.bankId}`, adminToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(bankA.bankId);
  });

  it("API-008: PATCH merge partiel préserve le slug et écrit un diff d'audit", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}`, adminToken, {
      name: "Bank A renommée",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; slug: string };
    expect(body.name).toBe("Bank A renommée");
    expect(body.slug).toBe("bank-a");
    const audit = await h.db.query(
      `SELECT diff FROM audit_log WHERE action = 'PATCH /banks/:id' AND entity_id = $1`,
      [bankA.bankId]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
    const row = audit.rows[audit.rows.length - 1] as { diff: { after: { name: string } } };
    expect(row.diff.after.name).toBe("Bank A renommée");
  });

  it("API-008: AUDITOR en lecture seule — mutation PATCH banque → 403", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}`, auditorToken, {
      name: "hack",
    });
    expect(res.status).toBe(403);
  });

  it("API-008: tenant-isolation — BANK_ADMIN de bank A ne lit pas la banque B (403)", async () => {
    const bankB = await seedBankAgency(h.db, "bank-b");
    const res = await req("GET", `/banks/${bankB.bankId}`, adminToken);
    expect(res.status).toBe(403);
  });
});
