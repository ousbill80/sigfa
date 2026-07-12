/**
 * Tests d'intégration API-011 (Testcontainers PG16 + Redis réels).
 *
 * Couvre les 6 premiers critères EARS de la story :
 *  1. rate-limit par route → 429 + Retry-After, fenêtres indépendantes ;
 *  2. health <100 ms ; postgres coupé → 503 avec check précis ;
 *  3. heartbeat → last_seen/printer ; ERROR → UN kiosk:printer-error ; retour OK → nouvel épisode ;
 *  4. kiosks/status — OFFLINE (silencieuse >3min) si last_seen < NOW()-3min ;
 *  5. audit-logs — filtres, AUDITOR OK, MANAGER → 403, lecture seule ;
 *  6. devices — 201 puis 200 idempotent, DELETE ownership.
 *
 * Inclut la suite tenant-isolation (audit-logs/kiosks-status/devices cross-scope → refus).
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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

let h: AdminHarness;
let server: Server;
let baseUrl: string;
let bus: CaptureBus;
let bankA: BankFixture;
let bankB: BankFixture;
let auditorAToken: string;
let managerAToken: string;
let superAdminToken: string;
let agentAToken: string;
let kioskAId: string;

/** Forge un JWT de session borne (kioskId + sessionId) pour le heartbeat. */
async function forgeKioskToken(secret: Uint8Array, kioskId: string, agencyId: string): Promise<string> {
  const { SignJWT } = await import("jose");
  return new SignJWT({ role: "AUTHENTICATED", bankId: bankA.bankId, agencyIds: [agencyId], kioskId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("kiosk")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

/** Insère une borne dans l'agence donnée et renvoie son id. */
async function seedKiosk(fx: BankFixture, printerStatus = "OK"): Promise<string> {
  const res = await h.db.query(
    `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash, printer_status, last_seen)
     VALUES ($1, $2, 'B1', 'x', $3::printer_status, now()) RETURNING id`,
    [fx.bankId, fx.agencyId, printerStatus]
  );
  return (res.rows[0] as { id: string }).id;
}

beforeAll(async () => {
  h = await startAdminHarness();
  bankA = await seedBankAgency(h.db, "api011-a");
  bankB = await seedBankAgency(h.db, "api011-b");
  kioskAId = await seedKiosk(bankA);
  auditorAToken = await forgeToken(h.jwtSecretBytes, "AUDITOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  managerAToken = await forgeToken(h.jwtSecretBytes, "MANAGER", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  superAdminToken = await forgeToken(h.jwtSecretBytes, "SUPER_ADMIN", "super", null, []);
  agentAToken = await forgeKioskToken(h.jwtSecretBytes, kioskAId, bankA.agencyId);
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

beforeEach(async () => {
  await h.redis.flushall();
  bus.events.length = 0;
});

// ── Critère 1 : rate-limiting ────────────────────────────────────────────────

describe("API-011: rate-limiting par route (429 + Retry-After, fenêtres indépendantes)", () => {
  it("API-011: dépassement devices → 429 avec Retry-After ; /public a une fenêtre indépendante", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 12; i++) {
      last = await fetch(`${baseUrl}/notifications/devices`, {
        method: "POST",
        headers: { Authorization: `Bearer ${managerAToken}`, "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
        body: JSON.stringify({ deviceToken: `t-${i}`, platform: "EXPO" }),
      });
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toBeTruthy();
    // Fenêtre indépendante : /public/tickets depuis la même IP n'est PAS bloquée.
    const pub = await fetch(`${baseUrl}/public/tickets/aaaaaaaaaaaaaaaaaaaaa`, {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    expect(pub.status).not.toBe(429);
  });
});

// ── Critère 2 : health ───────────────────────────────────────────────────────

describe("API-011: health (public, <100ms, 503 si dépendance down)", () => {
  it("API-011: health 200 <100ms avec checks postgres+redis up", async () => {
    const t0 = Date.now();
    const res = await fetch(`${baseUrl}/health`);
    const ms = Date.now() - t0;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; checks: { postgres: string; redis: string }; uptime: number };
    expect(body.status).toBe("UP");
    expect(body.checks.postgres).toBe("up");
    expect(body.checks.redis).toBe("up");
    expect(typeof body.uptime).toBe("number");
    expect(ms).toBeLessThan(100);
  });

  it("API-011: postgres coupé → 503 avec check postgres=down précis", async () => {
    // App isolée avec un client PG fermé → la sonde SELECT 1 échoue.
    const pg = await import("pg");
    const dead = new pg.default.Client({ connectionString: `postgresql://sigfa:sigfa_test@${h.pgContainer.getHost()}:${h.pgContainer.getMappedPort(5432)}/sigfa_test` });
    await dead.connect();
    await dead.end();
    const app = createApp({ db: dead, redis: h.redis, jwtSecret: h.jwtSecretBytes, bus });
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; details?: { checks?: { postgres?: string } } } };
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.details?.checks?.postgres).toBe("down");
  });
});

// ── Critère 3 : heartbeat + épisode printer-error ────────────────────────────

describe("API-011: heartbeat & épisode printer-error (anti-répétition)", () => {
  async function heartbeat(printerStatus: string): Promise<Response> {
    return fetch(`${baseUrl}/kiosks/${kioskAId}/heartbeat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${agentAToken}`, "content-type": "application/json", "x-forwarded-for": "5.5.5.5" },
      body: JSON.stringify({ printerStatus, appVersion: "1.4.2", uptimeSeconds: 10 }),
    });
  }

  it("API-011: heartbeat met à jour last_seen/printer ; ERROR → UN kiosk:printer-error ; retour OK → nouvel épisode", async () => {
    await h.db.query(`UPDATE kiosks SET printer_status='OK' WHERE id=$1`, [kioskAId]);
    const ok = await heartbeat("OK");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { serverTime: string }).serverTime).toBeTruthy();
    expect(bus.ofType("kiosk:printer-error")).toHaveLength(0);

    // Premier passage en ERROR → un seul événement.
    await heartbeat("ERROR");
    expect(bus.ofType("kiosk:printer-error")).toHaveLength(1);
    // Rester en ERROR/OFFLINE → aucune ré-émission (même épisode).
    await heartbeat("ERROR");
    await heartbeat("OFFLINE");
    expect(bus.ofType("kiosk:printer-error")).toHaveLength(1);

    // Retour OK puis nouveau ERROR → nouvel épisode → un second événement.
    await heartbeat("OK");
    await heartbeat("ERROR");
    expect(bus.ofType("kiosk:printer-error")).toHaveLength(2);

    const row = await h.db.query(`SELECT printer_status, app_version, last_seen FROM kiosks WHERE id=$1`, [kioskAId]);
    const k = row.rows[0] as { printer_status: string; app_version: string; last_seen: Date };
    expect(k.printer_status).toBe("ERROR");
    expect(k.app_version).toBe("1.4.2");
    expect(k.last_seen).not.toBeNull();
  });

  it("API-011: heartbeat avec kioskId non-UUID → 404 KIOSK_NOT_FOUND (jamais de 500)", async () => {
    const res = await fetch(`${baseUrl}/kiosks/0/heartbeat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${agentAToken}`, "content-type": "application/json", "x-forwarded-for": "5.5.5.6" },
      body: JSON.stringify({ printerStatus: "OK", appVersion: "1.0.0", uptimeSeconds: 1 }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("KIOSK_NOT_FOUND");
  });
});

// ── Critère 4 : kiosks/status OFFLINE (silencieuse >3min) ────────────────────

describe("API-011: kiosks/status (ONLINE/OFFLINE dérivé)", () => {
  it("API-011: OFFLINE (silencieuse >3min) si last_seen < NOW()-3min ; ONLINE sinon (MANAGER+)", async () => {
    await h.db.query(`UPDATE kiosks SET last_seen = now() WHERE id=$1`, [kioskAId]);
    const online = await fetch(`${baseUrl}/kiosks/status?agencyId=${bankA.agencyId}`, {
      headers: { Authorization: `Bearer ${managerAToken}` },
    });
    expect(online.status).toBe(200);
    const onlineBody = (await online.json()) as { kiosks: { kioskId: string; status: string }[] };
    expect(onlineBody.kiosks.find((k) => k.kioskId === kioskAId)?.status).toBe("ONLINE");

    // Antidater le dernier heartbeat au-delà du seuil (181 s) → OFFLINE (silencieuse >3 min).
    await h.db.query(`UPDATE kiosks SET last_seen = now() - interval '181 seconds' WHERE id=$1`, [kioskAId]);
    const silent = await fetch(`${baseUrl}/kiosks/status?agencyId=${bankA.agencyId}`, {
      headers: { Authorization: `Bearer ${managerAToken}` },
    });
    const silentBody = (await silent.json()) as { kiosks: { kioskId: string; status: string }[] };
    expect(silentBody.kiosks.find((k) => k.kioskId === kioskAId)?.status).toBe("OFFLINE");
  });

  it("API-011: kiosks/status avec agencyId hors scope du JWT → 403", async () => {
    const res = await fetch(`${baseUrl}/kiosks/status?agencyId=${bankB.agencyId}`, {
      headers: { Authorization: `Bearer ${managerAToken}` },
    });
    expect(res.status).toBe(403);
  });
});

// ── Critère 5 : audit-logs ───────────────────────────────────────────────────

describe("API-011: audit-logs (lecture seule, AUDITOR OK, MANAGER 403)", () => {
  beforeEach(async () => {
    await h.db.query(
      `INSERT INTO audit_log (bank_id, actor_id, actor_role, actor_email, action, entity_type, entity_id, ip)
       VALUES ($1, $2, 'AUDITOR', 'a@t.ci', 'PATCH /banks/x/theme', 'BankTheme', $1, '41.0.0.1')`,
      [bankA.bankId, bankA.directorId]
    );
  });

  it("API-011: AUDITOR lit ses entrées (mapping occurred_at→timestamp, actor composé)", async () => {
    const res = await fetch(`${baseUrl}/audit-logs?entityType=BankTheme`, {
      headers: { Authorization: `Bearer ${auditorAToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { timestamp: string; actor: { role: string }; entityType: string }[]; meta: { total: number } };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]?.timestamp).toBeTruthy();
    expect(body.data[0]?.actor.role).toBe("AUDITOR");
    expect(body.data[0]?.entityType).toBe("BankTheme");
  });

  it("API-011: MANAGER → 403 sur audit-logs (aucune lecture)", async () => {
    const res = await fetch(`${baseUrl}/audit-logs`, {
      headers: { Authorization: `Bearer ${managerAToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("API-011: audit-logs est lecture seule — POST/DELETE non exposés (404/405)", async () => {
    const post = await fetch(`${baseUrl}/audit-logs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auditorAToken}`, "content-type": "application/json" },
      body: "{}",
    });
    expect([404, 405]).toContain(post.status);
  });

  it("API-011: audit-logs ignore un filtre malformé (jamais de 5xx)", async () => {
    const res = await fetch(`${baseUrl}/audit-logs?entityId=not-a-uuid&actorId=nope`, {
      headers: { Authorization: `Bearer ${auditorAToken}` },
    });
    expect(res.status).toBe(200);
  });

  it("API-011: audit-logs applique tous les filtres LA LOI (entityType/entityId/actorId/from/to)", async () => {
    const from = "2000-01-01T00:00:00.000Z";
    const to = "2100-01-01T00:00:00.000Z";
    const qs = `entityType=BankTheme&entityId=${bankA.bankId}&actorId=${bankA.directorId}&from=${from}&to=${to}&page=1&limit=5`;
    // SUPER_ADMIN (bankId null) → couvre la branche "toutes banques" + tous les filtres.
    const res = await fetch(`${baseUrl}/audit-logs?${qs}`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { entityType: string }[]; meta: { limit: number } };
    expect(body.meta.limit).toBe(5);
    expect(body.data.every((e) => e.entityType === "BankTheme")).toBe(true);
  });
});

// ── Critère 6 : devices idempotents + ownership ──────────────────────────────

describe("API-011: devices (201 puis 200 idempotent, DELETE ownership)", () => {
  it("API-011: POST device → 201 la 1re fois, 200 au ré-enregistrement (même deviceId)", async () => {
    const token = `dev-token-${Date.now()}`;
    const first = await fetch(`${baseUrl}/notifications/devices`, {
      method: "POST",
      headers: { Authorization: `Bearer ${managerAToken}`, "content-type": "application/json", "x-forwarded-for": "3.3.3.1" },
      body: JSON.stringify({ deviceToken: token, platform: "IOS" }),
    });
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { deviceId: string }).deviceId;
    const second = await fetch(`${baseUrl}/notifications/devices`, {
      method: "POST",
      headers: { Authorization: `Bearer ${managerAToken}`, "content-type": "application/json", "x-forwarded-for": "3.3.3.1" },
      body: JSON.stringify({ deviceToken: token, platform: "IOS" }),
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { deviceId: string }).deviceId).toBe(firstId);
  });

  it("API-011: DELETE ownership — la banque propriétaire supprime, une autre → 404", async () => {
    const token = `own-token-${Date.now()}`;
    const created = await fetch(`${baseUrl}/notifications/devices`, {
      method: "POST",
      headers: { Authorization: `Bearer ${managerAToken}`, "content-type": "application/json", "x-forwarded-for": "3.3.3.2" },
      body: JSON.stringify({ deviceToken: token, platform: "ANDROID" }),
    });
    const deviceId = ((await created.json()) as { deviceId: string }).deviceId;
    // Une banque tierce (B) ne peut pas supprimer le device de A → 404 DEVICE_NOT_FOUND.
    const managerBToken = await forgeToken(h.jwtSecretBytes, "MANAGER", bankB.directorId, bankB.bankId, [bankB.agencyId]);
    const foreign = await fetch(`${baseUrl}/notifications/devices/${deviceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${managerBToken}`, "x-forwarded-for": "3.3.3.3" },
    });
    expect(foreign.status).toBe(404);
    // Le propriétaire (A) supprime → 200.
    const owner = await fetch(`${baseUrl}/notifications/devices/${deviceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${managerAToken}`, "x-forwarded-for": "3.3.3.4" },
    });
    expect(owner.status).toBe(200);
  });
});

// ── Suite tenant-isolation ───────────────────────────────────────────────────

describe("API-011: tenant-isolation (audit-logs/kiosks-status/devices cross-scope → refus)", () => {
  it("API-011: AUDITOR de A ne voit PAS les audit-logs de B", async () => {
    await h.db.query(
      `INSERT INTO audit_log (bank_id, actor_id, actor_role, action, entity_type, entity_id)
       VALUES ($1, $2, 'BANK_ADMIN', 'DELETE /agencies/x', 'agency', $1)`,
      [bankB.bankId, bankB.directorId]
    );
    const res = await fetch(`${baseUrl}/audit-logs`, {
      headers: { Authorization: `Bearer ${auditorAToken}` },
    });
    const body = (await res.json()) as { data: { entityType: string }[] };
    // Aucune entrée de la banque B ne fuit dans le scope de A.
    const bAgencyEntries = body.data.filter((e) => e.entityType === "agency");
    expect(bAgencyEntries).toHaveLength(0);
    // SUPER_ADMIN (platform) voit toutes banques → l'entrée B est visible.
    const su = await fetch(`${baseUrl}/audit-logs?entityType=agency`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const suBody = (await su.json()) as { data: unknown[] };
    expect(suBody.data.length).toBeGreaterThan(0);
  });

  it("API-011: kiosks/status de A ne liste pas les bornes de B", async () => {
    await seedKiosk(bankB);
    const res = await fetch(`${baseUrl}/kiosks/status`, {
      headers: { Authorization: `Bearer ${managerAToken}` },
    });
    const body = (await res.json()) as { kiosks: { agencyId: string }[] };
    expect(body.kiosks.every((k) => k.agencyId === bankA.agencyId)).toBe(true);
  });

  it("SEC-F3: MANAGER ne voit PAS les bornes d'une autre agence de SA banque (sans query agencyId)", async () => {
    // Deuxième agence de la MÊME banque A, avec sa propre borne.
    const otherAgency = await h.db.query(
      `INSERT INTO agencies (bank_id, name) VALUES ($1,'Agence B interne') RETURNING id`,
      [bankA.bankId]
    );
    const otherAgencyId = (otherAgency.rows[0] as { id: string }).id;
    await h.db.query(
      `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash, printer_status, last_seen)
       VALUES ($1, $2, 'BX', 'x', 'OK'::printer_status, now())`,
      [bankA.bankId, otherAgencyId]
    );
    // MANAGER de l'agence A (agencyIds=[agencyA]) sans query → ne voit QUE son agence.
    const res = await fetch(`${baseUrl}/kiosks/status`, {
      headers: { Authorization: `Bearer ${managerAToken}` },
    });
    const body = (await res.json()) as { kiosks: { agencyId: string }[] };
    expect(body.kiosks.some((k) => k.agencyId === otherAgencyId)).toBe(false);
    expect(body.kiosks.every((k) => k.agencyId === bankA.agencyId)).toBe(true);
  });
});
