/**
 * REP-001 — Tests d'intégration du routeur reports (Testcontainers PG16 réel).
 *
 * Couvre GET /reports/kpis (scope agency|network + partial) et
 * GET /reports/daily/:agencyId (rapport journalier), conformes CONTRACT-006.
 * RBAC : AUDITOR/AGENCY_DIRECTOR ; scope network → AnonymizedNetworkAggregate
 * (zéro champ personnel).
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
let auditorToken: string;
let dirToken: string;
let superToken: string;

async function req(method: string, path: string, token: string): Promise<Response> {
  return app.request(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-forwarded-for": "1.2.3.4" },
  });
}

/** Crée la table daily_agency_stats + colonnes reporting sur les tickets du harness admin. */
async function extendSchema(): Promise<void> {
  await h.db.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ`);
  await h.db.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS served_at TIMESTAMPTZ`);
  await h.db.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ`);
  await h.db.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS wait_time_seconds INTEGER`);
  await h.db.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS service_time_seconds INTEGER`);
  await h.db.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS feedback_score INTEGER`);
  await h.db.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tracking_id TEXT`);
  await h.db.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS channel TEXT`);
  await h.db.query(`CREATE TABLE IF NOT EXISTS daily_agency_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL, agency_id UUID NOT NULL, service_id UUID,
    day DATE NOT NULL,
    tickets_issued INTEGER NOT NULL DEFAULT 0, tickets_served INTEGER NOT NULL DEFAULT 0,
    tickets_abandoned INTEGER NOT NULL DEFAULT 0, tickets_no_show INTEGER NOT NULL DEFAULT 0,
    total_wait_seconds INTEGER NOT NULL DEFAULT 0, total_service_seconds INTEGER NOT NULL DEFAULT 0,
    sla_met_count INTEGER NOT NULL DEFAULT 0, sla_total_count INTEGER NOT NULL DEFAULT 0,
    feedback_count INTEGER NOT NULL DEFAULT 0, feedback_sum INTEGER NOT NULL DEFAULT 0,
    nps_promoters INTEGER NOT NULL DEFAULT 0, nps_passives INTEGER NOT NULL DEFAULT 0, nps_detractors INTEGER NOT NULL DEFAULT 0,
    agent_active_seconds INTEGER, agent_available_seconds INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await h.db.query(`CREATE UNIQUE INDEX IF NOT EXISTS das_no_svc ON daily_agency_stats (bank_id, agency_id, day) WHERE service_id IS NULL`);
  await h.db.query(`CREATE UNIQUE INDEX IF NOT EXISTS das_svc ON daily_agency_stats (bank_id, agency_id, service_id, day) WHERE service_id IS NOT NULL`);
}

/** Matérialise une ligne d'agrégat toutes-services pour une agence/jour. */
async function seedStats(agencyId: string, day: string): Promise<void> {
  await h.db.query(
    `INSERT INTO daily_agency_stats (bank_id, agency_id, service_id, day,
       tickets_issued, tickets_served, tickets_abandoned, tickets_no_show,
       total_wait_seconds, total_service_seconds, sla_met_count, sla_total_count,
       feedback_count, feedback_sum, nps_promoters, nps_passives, nps_detractors,
       agent_active_seconds, agent_available_seconds)
     VALUES ($1,$2,NULL,$3, 6,4,1,1, 2550,2160, 3,6, 3,11, 1,1,1, 28800,28800)`,
    [bankA.bankId, agencyId, day]
  );
}

beforeAll(async () => {
  h = await startAdminHarness();
  app = createApp({ db: h.db, redis: h.redis, jwtSecret: h.jwtSecretBytes });
  bankA = await seedBankAgency(h.db, "rep-bank-a");
  await extendSchema();
  await h.db.query(
    `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,'RS','Reporting',15)`,
    [bankA.bankId, bankA.agencyId]
  );
  await seedStats(bankA.agencyId, "2026-07-01");
  auditorToken = await forgeToken(h.jwtSecretBytes, "AUDITOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  dirToken = await forgeToken(h.jwtSecretBytes, "AGENCY_DIRECTOR", bankA.directorId, bankA.bankId, [bankA.agencyId]);
  superToken = await forgeToken(h.jwtSecretBytes, "SUPER_ADMIN", bankA.directorId, null, []);
}, 180_000);

afterAll(async () => {
  await stopAdminHarness(h);
}, 30_000);

describe("REP-001: GET /reports/kpis — scope agency", () => {
  it("REP-001: AUDITOR lit les KPIs agence — 7 KPIs + partial:false (jour figé)", async () => {
    // Jour unique passé (2026-07-01) : figé depuis 2026-07-03 07:00 Abidjan → partial:false.
    const res = await req("GET", `/reports/kpis?scope=agency&period=2026-07-01&agencyId=${bankA.agencyId}`, auditorToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scope: string; period: string; partial: boolean;
      kpis: {
        tma: { value: number; unit: string };
        tmt: { value: number; unit: string };
        tts: { value: number; unit: string };
        tauxSLA: { value: number }; nps: number | null; occupation: { value: number };
      };
    };
    expect(body.scope).toBe("agency");
    expect(body.period).toBe("2026-07-01");
    expect(body.partial).toBe(false);
    // Durées EXPOSÉES en minutes (frontière route) : le moteur calcule en secondes.
    // TMT = 2160 s service / 4 DONE = 540 s → 9 min. `unit:"minutes"` doit être VRAI.
    expect(body.kpis.tmt.value).toBe(9);
    expect(body.kpis.tmt.unit).toBe("minutes");
    // TMA = 2550 s attente / (4 DONE + 1 NO_SHOW = 5 servedCount) = 510 s → 8.5 min.
    expect(body.kpis.tma.value).toBe(8.5);
    expect(body.kpis.tma.unit).toBe("minutes");
    // TTS = TMA + TMT (secondes moteur : 510 + 540 = 1050 s) → 17.5 min.
    expect(body.kpis.tts.value).toBe(17.5);
    expect(body.kpis.tts.unit).toBe("minutes");
    expect(body.kpis.tauxSLA.value).toBe(50); // met 3 / total 6
    expect(body.kpis.nps).toBe(0);
    expect(body.kpis.occupation.value).toBe(100);
  });

  it("REP-001: période invalide → 400", async () => {
    const res = await req("GET", `/reports/kpis?scope=agency&period=juillet&agencyId=${bankA.agencyId}`, auditorToken);
    expect(res.status).toBe(400);
  });

  it("REP-001: scope manquant → 400", async () => {
    const res = await req("GET", `/reports/kpis?period=2026-07&agencyId=${bankA.agencyId}`, auditorToken);
    expect(res.status).toBe(400);
  });

  it("REP-001: agencyId hors scope JWT → 403", async () => {
    const other = "99999999-9999-4999-a999-999999999999";
    const res = await req("GET", `/reports/kpis?scope=agency&period=2026-07&agencyId=${other}`, auditorToken);
    expect(res.status).toBe(403);
  });

  it("REP-001: agence sans donnée → KPIs null, jamais 0/NaN", async () => {
    const res = await req("GET", `/reports/kpis?scope=agency&period=2026-08&agencyId=${bankA.agencyId}`, auditorToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kpis: { tma: { value: number | null }; nps: number | null } };
    expect(body.kpis.tma.value).toBeNull();
    expect(body.kpis.nps).toBeNull();
  });

  it("REP-001: sans agencyId mais une seule agence liée au JWT → résout automatiquement", async () => {
    const res = await req("GET", `/reports/kpis?scope=agency&period=2026-07-01`, auditorToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agencyId: string };
    expect(body.agencyId).toBe(bankA.agencyId);
  });

  it("REP-001: agencyId hors scope (format non-UUID) → 403 (garde middleware)", async () => {
    const res = await req("GET", `/reports/kpis?scope=agency&period=2026-07-01&agencyId=not-uuid`, auditorToken);
    expect(res.status).toBe(403);
  });

  it("REP-001: sans agencyId et plusieurs agences liées → 400", async () => {
    const multiToken = await forgeToken(h.jwtSecretBytes, "AUDITOR", bankA.directorId, bankA.bankId, [
      bankA.agencyId,
      "88888888-8888-4888-a888-888888888888",
    ]);
    const res = await req("GET", `/reports/kpis?scope=agency&period=2026-07-01`, multiToken);
    expect(res.status).toBe(400);
  });
});

describe("REP-001: conversion d'unité secondes → minutes (frontière route)", () => {
  it("REP-001: TMA moteur 90 s → 1,5 min exposées, unit:\"minutes\" VRAI", async () => {
    // Agrégat contrôlé : 1 DONE, 90 s d'attente, 60 s de service.
    // Moteur (secondes) : TMA = 90/1 = 90 s ; TMT = 60/1 = 60 s ; TTS = 150 s.
    // Frontière route (minutes) : TMA = 1.5 ; TMT = 1.0 ; TTS = 2.5.
    await h.db.query(
      `INSERT INTO daily_agency_stats (bank_id, agency_id, service_id, day,
         tickets_issued, tickets_served, tickets_abandoned, tickets_no_show,
         total_wait_seconds, total_service_seconds, sla_met_count, sla_total_count,
         feedback_count, feedback_sum, nps_promoters, nps_passives, nps_detractors,
         agent_active_seconds, agent_available_seconds)
       VALUES ($1,$2,NULL,'2026-06-15', 1,1,0,0, 90,60, 1,1, 0,0, 0,0,0, NULL,NULL)`,
      [bankA.bankId, bankA.agencyId]
    );
    const res = await req("GET", `/reports/kpis?scope=agency&period=2026-06-15&agencyId=${bankA.agencyId}`, auditorToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kpis: {
        tma: { value: number; unit: string };
        tmt: { value: number; unit: string };
        tts: { value: number; unit: string };
      };
    };
    expect(body.kpis.tma.value).toBe(1.5);
    expect(body.kpis.tma.unit).toBe("minutes");
    expect(body.kpis.tmt.value).toBe(1);
    expect(body.kpis.tmt.unit).toBe("minutes");
    expect(body.kpis.tts.value).toBe(2.5);
    expect(body.kpis.tts.unit).toBe("minutes");
  });
});

describe("REP-001: GET /reports/kpis — scope network (AnonymizedNetworkAggregate)", () => {
  it("REP-001: SUPER_ADMIN lit le réseau — zéro champ personnel", async () => {
    const res = await req("GET", `/reports/kpis?scope=network&period=2026-07`, superToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scope: string; aggregate: Record<string, unknown> };
    expect(body.scope).toBe("network");
    const forbidden = ["agencyId", "bankId", "agentId", "phone", "email", "name", "userId"];
    const serialized = JSON.stringify(body);
    for (const field of forbidden) {
      expect(serialized).not.toContain(field);
    }
    expect(typeof body.aggregate["totalTickets"]).toBe("number");
    expect(typeof body.aggregate["agencyCount"]).toBe("number");
  });

  it("REP-001: réseau sur période à observations nulles → moyennes = 0 (fallback null→0, jamais NaN)", async () => {
    // Ligne réseau avec 0 servi/0 feedback/0 available → tous KPIs null → exposés à 0.
    await h.db.query(
      `INSERT INTO daily_agency_stats (bank_id, agency_id, service_id, day,
         tickets_issued, tickets_served, tickets_abandoned, tickets_no_show,
         total_wait_seconds, total_service_seconds, sla_met_count, sla_total_count,
         feedback_count, feedback_sum, nps_promoters, nps_passives, nps_detractors,
         agent_active_seconds, agent_available_seconds)
       VALUES ($1,$2,NULL,'2026-05-01', 0,0,0,0, 0,0, 0,0, 0,0, 0,0,0, NULL,NULL)`,
      [bankA.bankId, bankA.agencyId]
    );
    const res = await req("GET", `/reports/kpis?scope=network&period=2026-05-01`, superToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { aggregate: Record<string, number> };
    expect(body.aggregate["avgTma"]).toBe(0);
    expect(body.aggregate["avgOccupation"]).toBe(0);
    expect(Number.isNaN(body.aggregate["avgTma"])).toBe(false);
  });
});

describe("REP-001: GET /reports/daily/:agencyId", () => {
  it("REP-001: DIRECTOR lit le rapport journalier — KPIs du jour + totalTickets", async () => {
    const res = await req("GET", `/reports/daily/${bankA.agencyId}?date=2026-07-01`, dirToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agencyId: string; date: string; totalTickets: number;
      kpis: { tmt: { value: number; unit: string } }; partial: boolean;
    };
    expect(body.agencyId).toBe(bankA.agencyId);
    expect(body.date).toBe("2026-07-01");
    expect(body.totalTickets).toBe(6);
    // 540 s moteur → 9 min exposées (frontière route), `unit:"minutes"` VRAI.
    expect(body.kpis.tmt.value).toBe(9);
    expect(body.kpis.tmt.unit).toBe("minutes");
    expect(body.partial).toBe(false);
  });

  it("REP-001: agencyId invalide (non UUID) → 404", async () => {
    const res = await req("GET", `/reports/daily/not-a-uuid?date=2026-07-01`, dirToken);
    expect(res.status).toBe(404);
  });

  it("REP-001: date invalide → 400", async () => {
    const res = await req("GET", `/reports/daily/${bankA.agencyId}?date=2026-13-99`, dirToken);
    expect(res.status).toBe(400);
  });

  it("REP-001: sans date → défaut hier (jour Abidjan), agrégat vide (aucune donnée hier)", async () => {
    const res = await req("GET", `/reports/daily/${bankA.agencyId}`, dirToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { date: string; totalTickets: number; agencyName?: string };
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.totalTickets).toBe(0);
    expect(body.agencyName).toBe("Agence");
  });
});
