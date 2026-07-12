/**
 * Tests d'intégration — import CSV d'agents API-009 (agents.yaml, Testcontainers).
 *
 * Couvre : 500 lignes OK, 501 → 422 ; lignes invalides → errors précis, lignes
 * valides créées (transaction par ligne) ; téléphone non-E.164 →
 * INVALID_PHONE_FORMAT ; mot de passe initial JAMAIS renvoyé.
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
let counter = 0;

const HEADER = "email,firstName,lastName,role,agencyCode,languages,phone";

async function importCsv(csv: string, token = adminToken): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "agents.csv");
  return app.request("/api/v1/agents/import", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

function build(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

/** Génère un email unique par test pour éviter les collisions d'unicité globale. */
function uniqueEmail(tag: string): string {
  counter += 1;
  return `${tag}-${counter}@banque-ci.com`;
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "imp-bank-a");
  adminToken = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("API-009: import CSV — 500 OK, 501 → 422, lignes invalides précises", () => {
  it("API-009: import CSV — 500 lignes OK", async () => {
    const rows = Array.from({ length: 500 }, () => `${uniqueEmail("ok500")},A,B,AGENT,,FR,`);
    const res = await importCsv(build(rows));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: number; errors: unknown[] };
    expect(body.created).toBe(500);
    expect(body.errors).toHaveLength(0);
  }, 60_000);

  it("API-009: import CSV — 501 lignes → 422 IMPORT_TOO_LARGE", async () => {
    const rows = Array.from({ length: 501 }, () => `${uniqueEmail("big")},A,B,AGENT,,FR,`);
    const res = await importCsv(build(rows));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("IMPORT_TOO_LARGE");
  });

  it("API-009: lignes invalides → errors précis, valides créées", async () => {
    const good = uniqueEmail("good");
    const res = await importCsv(
      build([`${good},Kofi,Asante,AGENT,,FR,`, "bad@b.ci,,B,SUPERVISOR,,FR,"])
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      created: number;
      skipped: number;
      errors: Array<{ line: number; field: string; code: string }>;
    };
    expect(body.created).toBe(1);
    // Ligne 3 invalide : firstName manquant + rôle invalide.
    expect(body.errors.some((e) => e.line === 3 && e.field === "role" && e.code === "INVALID_ROLE")).toBe(true);
    // La ligne valide a bien été créée.
    const created = await h.db.query(`SELECT 1 FROM users WHERE email=$1`, [good]);
    expect(created.rows).toHaveLength(1);
  });

  it("API-009: téléphone non-E.164 → INVALID_PHONE_FORMAT", async () => {
    const res = await importCsv(build([`${uniqueEmail("phone")},A,B,AGENT,,FR,0700000001`]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: number; errors: Array<{ field: string; code: string }> };
    expect(body.created).toBe(0);
    expect(body.errors[0]).toMatchObject({ field: "phone", code: "INVALID_PHONE_FORMAT" });
  });

  it("API-009: doublon email → skipped + DUPLICATE_EMAIL (transaction par ligne)", async () => {
    const dup = uniqueEmail("dup");
    await importCsv(build([`${dup},A,B,AGENT,,FR,`]));
    const res = await importCsv(build([`${dup},A,B,AGENT,,FR,`]));
    const body = (await res.json()) as { created: number; skipped: number; errors: Array<{ code: string }> };
    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.errors[0]?.code).toBe("DUPLICATE_EMAIL");
  });

  it("API-009: mot de passe initial JAMAIS dans la réponse", async () => {
    const res = await importCsv(build([`${uniqueEmail("pwd")},A,B,AGENT,,FR,`]));
    const text = await res.text();
    expect(text.toLowerCase()).not.toContain("password");
    expect(text).not.toContain("password_hash");
  });

  it("API-009: agencyCode connu → agent rattaché à l'agence (agency_users)", async () => {
    // L'agence par défaut du harnais se nomme 'Agence' ; on l'utilise comme code.
    const email = uniqueEmail("linked");
    const res = await importCsv(build([`${email},Kofi,Asante,AGENT,Agence,FR,`]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: number };
    expect(body.created).toBe(1);
    const link = await h.db.query(
      `SELECT au.agency_id FROM agency_users au
         JOIN users u ON u.id = au.user_id WHERE u.email = $1`,
      [email]
    );
    expect(link.rows).toHaveLength(1);
    expect((link.rows[0] as { agency_id: string }).agency_id).toBe(bankA.agencyId);
  });

  it("API-009: agencyCode inconnu → skipped + AGENCY_NOT_FOUND (ligne valide isolée)", async () => {
    const res = await importCsv(build([`${uniqueEmail("noag")},A,B,AGENT,ZZZ_INCONNU,FR,`]));
    const body = (await res.json()) as { created: number; skipped: number; errors: Array<{ code: string; field: string }> };
    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.errors[0]).toMatchObject({ field: "agencyCode", code: "AGENCY_NOT_FOUND" });
  });

  it("SEC-F3: AGENCY_DIRECTOR importe BANK_ADMIN → rejeté ROLE_NOT_ALLOWED, AGENT créé", async () => {
    const adminEmail = uniqueEmail("escalade-admin");
    const agentEmail = uniqueEmail("escalade-agent");
    const res = await importCsv(
      build([`${adminEmail},E,F,BANK_ADMIN,,FR,`, `${agentEmail},G,H,AGENT,,FR,`])
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      created: number;
      errors: Array<{ line: number; field: string; code: string }>;
    };
    // Seul l'AGENT est créé ; la ligne BANK_ADMIN est rejetée.
    expect(body.created).toBe(1);
    expect(body.errors.some((e) => e.line === 2 && e.field === "role" && e.code === "ROLE_NOT_ALLOWED")).toBe(true);
    // Le BANK_ADMIN n'existe PAS en base (pas d'escalade).
    const admin = await h.db.query(`SELECT 1 FROM users WHERE email=$1`, [adminEmail]);
    expect(admin.rows).toHaveLength(0);
    const agent = await h.db.query(`SELECT role FROM users WHERE email=$1`, [agentEmail]);
    expect(agent.rows).toHaveLength(1);
    expect((agent.rows[0] as { role: string }).role).toBe("AGENT");
  });

  it("API-009: multipart sans champ 'file' → 400 BAD_REQUEST", async () => {
    const form = new FormData();
    form.append("other", "x");
    const res = await app.request("/api/v1/agents/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});
