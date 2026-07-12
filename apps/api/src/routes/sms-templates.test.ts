/**
 * Tests d'intégration — routeur templates SMS API-008 (Testcontainers PG16).
 *
 * Couvre : GET/PATCH upsert, variable inconnue → 422 UNKNOWN_TEMPLATE_VARIABLE,
 * champ inconnu → 422, audit, RBAC (AUDITOR → 403), tenant-isolation.
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
let adminToken: string;
let auditorToken: string;

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
  bankA = await seedBankAgency(h.db, "sms-bank-a");
  adminToken = await forgeToken(h.jwtSecretBytes, "BANK_ADMIN", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  auditorToken = await forgeToken(h.jwtSecretBytes, "AUDITOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-008: templates SMS + validation variables + audit", () => {
  it("API-008: PATCH upsert un template valide + audit", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/sms-templates`, adminToken, {
      templates: [{ type: "TICKET_CONFIRMATION", content: "Ticket {{number}}, position {{position}}." }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { templates: Array<{ type: string; content: string }> };
    expect(body.templates.find((t) => t.type === "TICKET_CONFIRMATION")).toBeDefined();
    const audit = await h.db.query(
      `SELECT 1 FROM audit_log WHERE action='PATCH /banks/:id/sms-templates' AND entity_id=$1`, [bankA.bankId]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("API-008: GET retourne les templates persistés", async () => {
    const res = await req("GET", `/banks/${bankA.bankId}/sms-templates`, adminToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { templates: unknown[] };
    expect(body.templates.length).toBeGreaterThanOrEqual(1);
  });

  it("API-008: variable inconnue → 422 UNKNOWN_TEMPLATE_VARIABLE", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/sms-templates`, adminToken, {
      templates: [{ type: "YOUR_TURN", content: "Bonjour {{agentName}}" }],
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details?: { unknownVariable?: string } } };
    expect(body.error.code).toBe("UNKNOWN_TEMPLATE_VARIABLE");
    expect(body.error.details?.unknownVariable).toBe("{{agentName}}");
  });

  it("API-008: champ hors schéma → 422", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/sms-templates`, adminToken, {
      templates: [{ type: "YOUR_TURN", content: "OK", boom: 1 }],
    });
    expect(res.status).toBe(422);
  });

  it("API-008: RBAC — AUDITOR ne peut pas modifier les templates (403)", async () => {
    const res = await req("PATCH", `/banks/${bankA.bankId}/sms-templates`, auditorToken, {
      templates: [{ type: "YOUR_TURN", content: "OK {{number}}" }],
    });
    expect(res.status).toBe(403);
  });

  it("API-008: tenant-isolation — BANK_ADMIN de A ne lit pas les templates de B (403)", async () => {
    const bankB = await seedBankAgency(h.db, "sms-bank-b");
    const res = await req("GET", `/banks/${bankB.bankId}/sms-templates`, adminToken);
    expect(res.status).toBe(403);
  });
});
