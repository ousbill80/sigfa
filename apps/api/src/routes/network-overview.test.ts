/**
 * Tests d'intégration NET-001-API — Console Super Admin cross-tenant (LECTURE SEULE).
 *
 * Testcontainers PG16 + Redis réels (harnais admin). Couvre les critères EARS API :
 *  - RBAC exhaustif : SUPER_ADMIN seul ; BANK_ADMIN/AUDITOR/MANAGER/AGENT → 403.
 *  - Allow-list : agrégats/compteurs par banque + réseau, ZÉRO PII.
 *  - Lecture seule : POST/PATCH/PUT/DELETE sur le périmètre platform → 403 PLATFORM_READ_ONLY.
 *  - Audit : chaque lecture cross-tenant écrit une entrée PLATFORM_READ immuable
 *    (scope CROSS_TENANT) par banque lue.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createApp } from "src/app.js";
import { createCaptureBus, type CaptureBus } from "src/services/realtime.js";
import {
  startAdminHarness,
  stopAdminHarness,
  forgeToken,
  seedBankAgency,
  type AdminHarness,
  type BankFixture,
} from "src/routes/admin-test-harness.js";
import { FORBIDDEN_PII_KEY_PATTERNS } from "src/lib/network-overview-allowlist.js";

let h: AdminHarness;
let server: Server;
let baseUrl: string;
let bus: CaptureBus;
let bankA: BankFixture;
let bankB: BankFixture;
let superAdminToken: string;

/** Collecte récursivement toutes les clés (profondeur incluse) d'une réponse JSON. */
function allKeysDeep(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) allKeysDeep(item, acc);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.push(k);
      allKeysDeep(v, acc);
    }
  }
  return acc;
}

/** Insère une borne dans l'agence donnée, avec un dernier heartbeat daté. */
async function seedKiosk(fx: BankFixture, lastSeenSql: string): Promise<void> {
  await h.db.query(
    `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash, printer_status, last_seen)
     VALUES ($1, $2, 'B', 'x', 'OK'::printer_status, ${lastSeenSql})`,
    [fx.bankId, fx.agencyId]
  );
}

/** Insère un ticket (avec PII : phone/display_number) pour vérifier l'anonymisation. */
async function seedTicket(fx: BankFixture): Promise<void> {
  const svc = await h.db.query(
    // Schéma FIDÈLE : `services.code` contraint `^[A-Z]{2,4}$` (services_code_format).
    `INSERT INTO services (bank_id, agency_id, code, name) VALUES ($1,$2,'SVC','Service') RETURNING id`,
    [fx.bankId, fx.agencyId]
  );
  const serviceId = (svc.rows[0] as { id: string }).id;
  const q = await h.db.query(
    `INSERT INTO queues (bank_id, agency_id, service_id) VALUES ($1,$2,$3) RETURNING id`,
    [fx.bankId, fx.agencyId, serviceId]
  );
  const queueId = (q.rows[0] as { id: string }).id;
  await h.db.query(
    // Schéma FIDÈLE : `tickets.tracking_id` (char(21) UNIQUE) et `channel` NOT NULL sans défaut.
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, number, display_number, status, phone_encrypted, issued_at, tracking_id, channel)
     VALUES ($1,$2,$3,$4, 1, 'A-001', 'WAITING', 'CIPHER', NOW(), 'trkNetOverview0000001', 'KIOSK')`,
    [fx.bankId, fx.agencyId, queueId, serviceId]
  );
}

beforeAll(async () => {
  h = await startAdminHarness();
  bankA = await seedBankAgency(h.db, "net001-a");
  bankB = await seedBankAgency(h.db, "net001-b");
  // Banque A : 1 borne ONLINE + 1 borne OFFLINE (muette) + 1 ticket (avec PII).
  await seedKiosk(bankA, "now()");
  await seedKiosk(bankA, "now() - interval '600 seconds'");
  await seedTicket(bankA);
  // Banque B : 1 borne ONLINE.
  await seedKiosk(bankB, "now()");
  // SUPER_ADMIN plateforme (bank_id NULL) — id UUID réel pour l'attribution d'audit.
  const su = await h.db.query(
    `INSERT INTO users (bank_id, email, password_hash, first_name, last_name, role) VALUES (NULL, 'net001-super@sigfa.ci', 'x', 'Super', 'Admin', 'SUPER_ADMIN') RETURNING id`
  );
  const superAdminId = (su.rows[0] as { id: string }).id;
  superAdminToken = await forgeToken(h.jwtSecretBytes, "SUPER_ADMIN", superAdminId, null, []);
  bus = createCaptureBus();
  const app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes, bus });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://127.0.0.1:${info.port}/api/v1`;
      resolve();
    }) as Server;
  });
}, 180_000);

afterAll(async () => {
  server?.close();
  await stopAdminHarness(h);
}, 30_000);

describe("NET-001: /admin/network-overview accessible SUPER_ADMIN uniquement (RBAC exhaustif par rôle)", () => {
  it("NET-001: SUPER_ADMIN → 200 avec agrégats réseau", async () => {
    const res = await fetch(`${baseUrl}/admin/network-overview`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      period: string;
      aggregate: { bankCount: number };
      banks: { bankId: string }[];
    };
    expect(body.period).toMatch(/^\d{4}-\d{2}$/);
    expect(body.aggregate.bankCount).toBeGreaterThanOrEqual(2);
    expect(body.banks.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["BANK_ADMIN"],
    ["AUDITOR"],
    ["MANAGER"],
    ["AGENT"],
    ["AGENCY_DIRECTOR"],
  ])("NET-001: %s → 403 (route jamais rabaissée à un rôle tenant)", async (role) => {
    const token = await forgeToken(h.jwtSecretBytes, role, bankA.directorId, bankA.bankId, [bankA.agencyId]);
    const res = await fetch(`${baseUrl}/admin/network-overview`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("NET-001: sans token → 401", async () => {
    const res = await fetch(`${baseUrl}/admin/network-overview`);
    expect(res.status).toBe(401);
  });
});

describe("NET-001: allow-list stricte — agrégats/compteurs UNIQUEMENT, zéro PII client", () => {
  it("NET-001: réponse ne contient AUCUN champ PII (phone, tracking, feedback, display_number, agent…) malgré un ticket porteur de PII", async () => {
    const res = await fetch(`${baseUrl}/admin/network-overview`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const body = await res.json();
    const keys = allKeysDeep(body).map((k) => k.toLowerCase());
    for (const forbidden of FORBIDDEN_PII_KEY_PATTERNS) {
      expect(
        keys.some((k) => k.includes(forbidden)),
        `Champ PII/métier interdit dans la réponse : ${forbidden}`
      ).toBe(false);
    }
  });

  it("NET-001: par banque — bankId + bankLabel + compteurs bornes ONLINE/OFFLINE dérivés", async () => {
    const res = await fetch(`${baseUrl}/admin/network-overview`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const body = (await res.json()) as {
      banks: {
        bankId: string;
        bankLabel: string;
        kiosksOnline: number;
        kiosksOffline: number;
        health: string;
        uptimePercent: number;
      }[];
    };
    const a = body.banks.find((b) => b.bankId === bankA.bankId);
    expect(a).toBeDefined();
    expect(a?.bankLabel).toBe("net001-a");
    // A : 1 borne ONLINE + 1 borne muette (OFFLINE).
    expect(a?.kiosksOnline).toBe(1);
    expect(a?.kiosksOffline).toBe(1);
    expect(["VERT", "ORANGE", "ROUGE"]).toContain(a?.health);
    expect(a?.uptimePercent).toBe(50);
  });

  it("NET-001: period invalide → 400 (jamais de 500)", async () => {
    const res = await fetch(`${baseUrl}/admin/network-overview?period=2026-13-99`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    expect(res.status).toBe(400);
  });
});

describe("NET-001: LECTURE SEULE — mutation platform → 403 PLATFORM_READ_ONLY", () => {
  it.each([["POST"], ["PATCH"], ["PUT"], ["DELETE"]])(
    "NET-001: %s /admin/network-overview → 403 PLATFORM_READ_ONLY",
    async (method) => {
      const res = await fetch(`${baseUrl}/admin/network-overview`, {
        method,
        headers: { Authorization: `Bearer ${superAdminToken}`, "content-type": "application/json" },
        body: method === "DELETE" ? undefined : "{}",
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("PLATFORM_READ_ONLY");
    }
  );
});

describe("NET-001: audit cross-tenant — chaque lecture écrit PLATFORM_READ immuable (scope CROSS_TENANT)", () => {
  it("NET-001: une lecture écrit une entrée PLATFORM_READ par banque lue, attribuée au SUPER_ADMIN, scope CROSS_TENANT", async () => {
    // Schéma FIDÈLE : `audit_log` est IMMUABLE (trigger `audit_log_no_delete`, 0003) —
    // impossible de purger avant lecture. On mesure donc le DELTA de la requête : au
    // moins une entrée PLATFORM_READ par banque lue (A + B) est ajoutée par CE GET.
    const before = await h.db.query(
      `SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'PLATFORM_READ'`
    );
    const beforeCount = (before.rows[0] as { n: number }).n;
    const res = await fetch(`${baseUrl}/admin/network-overview`, {
      headers: { Authorization: `Bearer ${superAdminToken}`, "x-forwarded-for": "41.0.0.9" },
    });
    expect(res.status).toBe(200);
    const rows = await h.db.query(
      `SELECT bank_id, actor_role, action, entity_type, diff FROM audit_log WHERE action = 'PLATFORM_READ' ORDER BY bank_id`
    );
    // Au moins une entrée par banque lue (A + B) ajoutée par cette requête.
    expect(rows.rows.length - beforeCount).toBeGreaterThanOrEqual(2);
    expect(rows.rows.length).toBeGreaterThanOrEqual(2);
    const first = rows.rows[0] as {
      actor_role: string;
      entity_type: string;
      diff: { scope: string; resource: string };
    };
    expect(first.actor_role).toBe("SUPER_ADMIN");
    expect(first.entity_type).toBe("network");
    expect(first.diff.scope).toBe("CROSS_TENANT");
    expect(first.diff.resource).toBe("GET /admin/network-overview");
    // L'entrée d'audit ne porte AUCUNE PII.
    const diffKeys = Object.keys(first.diff).map((k) => k.toLowerCase());
    expect(diffKeys.some((k) => k.includes("phone"))).toBe(false);
  });
});
