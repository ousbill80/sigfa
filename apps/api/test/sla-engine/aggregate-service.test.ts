/**
 * REP-001 — Tests d'intégration `aggregate-service` (Testcontainers PostgreSQL 16 RÉEL).
 *
 * Vérifie la lecture des agrégats matérialisés `daily_agency_stats` (DB-006),
 * leur mapping vers `DailyStatsAggregate` (formules D2), l'agrégation multi-jours
 * par somme, la recalc idempotente, et le champ `partial`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPostgresContainer } from "@sigfa/testing/tenant-isolation";
import type { PostgresHarness } from "@sigfa/testing/tenant-isolation";
import {
  loadAgencyAggregate,
  computeAgencyKpiResponse,
  recalcAgencyDay,
  mapRowToAggregate,
  type DailyStatsRow,
} from "src/reporting/aggregate-service.js";

let h: PostgresHarness;

const BANK_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const AGENCY_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const SERVICE_ID = "aaaaaaaa-0001-4000-8000-000000000003";
const QUEUE_ID = "aaaaaaaa-0001-4000-8000-000000000004";
const AGENT_ID = "aaaaaaaa-0001-4000-8000-000000000006";

/** Crée le schéma minimal reporting (tickets + agent_status_history + daily_agency_stats). */
async function applySchema(pg: PostgresHarness): Promise<void> {
  await pg.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await pg.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='ticket_status') THEN
        CREATE TYPE ticket_status AS ENUM ('WAITING','CALLED','SERVING','DONE','NO_SHOW','ABANDONED','TRANSFERRED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='agent_status') THEN
        CREATE TYPE agent_status AS ENUM ('AVAILABLE','SERVING','PAUSED','ABSENT','OFFLINE'); END IF;
    END $$;
  `);
  await pg.query(`CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL);`);
  await pg.query(`CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY, bank_id UUID NOT NULL, name TEXT NOT NULL);`);
  await pg.query(`CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY, bank_id UUID NOT NULL, agency_id UUID NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, sla_minutes INTEGER NOT NULL DEFAULT 15);`);
  await pg.query(`CREATE TABLE IF NOT EXISTS queues (id UUID PRIMARY KEY, bank_id UUID NOT NULL, agency_id UUID NOT NULL, service_id UUID NOT NULL);`);
  await pg.query(`CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL, agency_id UUID NOT NULL,
    queue_id UUID NOT NULL, service_id UUID NOT NULL, status ticket_status NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL, called_at TIMESTAMPTZ, served_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, no_show_at TIMESTAMPTZ,
    wait_time_seconds INTEGER, service_time_seconds INTEGER, feedback_score INTEGER);`);
  await pg.query(`CREATE TABLE IF NOT EXISTS agent_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL, agency_id UUID NOT NULL,
    agent_id UUID NOT NULL, from_status agent_status, to_status agent_status NOT NULL, changed_at TIMESTAMPTZ NOT NULL);`);
  await pg.query(`CREATE TABLE IF NOT EXISTS daily_agency_stats (
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
  await pg.query(`CREATE UNIQUE INDEX IF NOT EXISTS das_no_service_uniq ON daily_agency_stats (bank_id, agency_id, day) WHERE service_id IS NULL;`);
  await pg.query(`CREATE UNIQUE INDEX IF NOT EXISTS das_with_service_uniq ON daily_agency_stats (bank_id, agency_id, service_id, day) WHERE service_id IS NOT NULL;`);
}

/** Insère un ticket. */
async function insertTicket(t: {
  status: string; issuedAt: string; calledAt?: string | null; servedAt?: string | null;
  closedAt?: string | null; noShowAt?: string | null; wait?: number | null; service?: number | null; feedback?: number | null;
}): Promise<void> {
  await h.query(
    `INSERT INTO tickets (bank_id, agency_id, queue_id, service_id, status, issued_at, called_at, served_at, closed_at, no_show_at, wait_time_seconds, service_time_seconds, feedback_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [BANK_ID, AGENCY_ID, QUEUE_ID, SERVICE_ID, t.status, t.issuedAt, t.calledAt ?? null, t.servedAt ?? null,
      t.closedAt ?? null, t.noShowAt ?? null, t.wait ?? null, t.service ?? null, t.feedback ?? null]
  );
}

beforeAll(async () => {
  h = await startPostgresContainer();
  await applySchema(h);
  await h.query(`INSERT INTO banks (id, name, slug) VALUES ($1,'B','b') ON CONFLICT DO NOTHING`, [BANK_ID]);
  await h.query(`INSERT INTO agencies (id, bank_id, name) VALUES ($1,$2,'A') ON CONFLICT DO NOTHING`, [AGENCY_ID, BANK_ID]);
  await h.query(`INSERT INTO services (id, bank_id, agency_id, code, name, sla_minutes) VALUES ($1,$2,$3,'SVC','S',15) ON CONFLICT DO NOTHING`, [SERVICE_ID, BANK_ID, AGENCY_ID]);
  await h.query(`INSERT INTO queues (id, bank_id, agency_id, service_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [QUEUE_ID, BANK_ID, AGENCY_ID, SERVICE_ID]);
}, 180_000);

afterAll(async () => {
  await h?.stop();
}, 30_000);

describe("REP-001: aggregate-service — mapRowToAggregate (D2)", () => {
  it("REP-001: mappe une ligne daily_agency_stats vers DailyStatsAggregate (served=DONE+NO_SHOW, sla_total=served+abandon)", () => {
    const row: DailyStatsRow = {
      tickets_issued: 6, tickets_served: 4, tickets_abandoned: 1, tickets_no_show: 1,
      total_wait_seconds: 2550, total_service_seconds: 2160,
      sla_met_count: 3, sla_total_count: 4,
      feedback_count: 3, nps_promoters: 1, nps_passives: 1, nps_detractors: 1,
      agent_active_seconds: 28800, agent_available_seconds: 28800,
    };
    const agg = mapRowToAggregate(row);
    expect(agg.doneCount).toBe(4);
    expect(agg.servedCount).toBe(5); // DONE(4) + NO_SHOW(1) = appelés
    expect(agg.abandonedCount).toBe(1);
    expect(agg.slaTotalCount).toBe(4);
    expect(agg.agentAvailableSeconds).toBe(28800);
  });

  it("REP-001: agent_available_seconds null → agentAvailableSeconds null (occupation non calculable)", () => {
    const row: DailyStatsRow = {
      tickets_issued: 0, tickets_served: 0, tickets_abandoned: 0, tickets_no_show: 0,
      total_wait_seconds: 0, total_service_seconds: 0, sla_met_count: 0, sla_total_count: 0,
      feedback_count: 0, nps_promoters: 0, nps_passives: 0, nps_detractors: 0,
      agent_active_seconds: null, agent_available_seconds: null,
    };
    expect(mapRowToAggregate(row).agentAvailableSeconds).toBeNull();
  });
});

describe("REP-001: aggregate-service — recalc idempotent + lecture", () => {
  it("REP-001: recalcAgencyDay depuis tickets → daily_agency_stats, rejoué 2× → KPIs identiques (idempotence)", async () => {
    // 4 DONE, 1 ABANDONED, 1 NO_SHOW le 2026-07-01 (Abidjan = UTC+0)
    await insertTicket({ status: "DONE", issuedAt: "2026-07-01T08:00:00Z", calledAt: "2026-07-01T08:05:00Z", servedAt: "2026-07-01T08:10:00Z", closedAt: "2026-07-01T08:20:00Z", wait: 300, service: 600, feedback: 5 });
    await insertTicket({ status: "DONE", issuedAt: "2026-07-01T08:30:00Z", calledAt: "2026-07-01T08:40:00Z", servedAt: "2026-07-01T08:50:00Z", closedAt: "2026-07-01T08:58:00Z", wait: 600, service: 480, feedback: 4 });
    await insertTicket({ status: "DONE", issuedAt: "2026-07-01T09:00:00Z", calledAt: "2026-07-01T09:20:00Z", servedAt: "2026-07-01T09:35:00Z", closedAt: "2026-07-01T09:41:00Z", wait: 1200, service: 360, feedback: 2 });
    await insertTicket({ status: "DONE", issuedAt: "2026-07-01T10:00:00Z", calledAt: "2026-07-01T10:07:30Z", servedAt: "2026-07-01T10:15:00Z", closedAt: "2026-07-01T10:27:00Z", wait: 450, service: 720, feedback: null });
    await insertTicket({ status: "ABANDONED", issuedAt: "2026-07-01T11:00:00Z" });
    await insertTicket({ status: "NO_SHOW", issuedAt: "2026-07-01T11:30:00Z", calledAt: "2026-07-01T11:45:00Z", noShowAt: "2026-07-01T11:50:00Z" });
    // Agent : disponible 08:00→17:00 (avec pause 12:00→13:00)
    for (const [from, to, at] of [
      [null, "AVAILABLE", "2026-07-01T08:00:00Z"],
      ["AVAILABLE", "PAUSED", "2026-07-01T12:00:00Z"],
      ["PAUSED", "AVAILABLE", "2026-07-01T13:00:00Z"],
      ["AVAILABLE", "OFFLINE", "2026-07-01T17:00:00Z"],
    ] as const) {
      await h.query(`INSERT INTO agent_status_history (bank_id, agency_id, agent_id, from_status, to_status, changed_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [BANK_ID, AGENCY_ID, AGENT_ID, from, to, at]);
    }

    const n1 = await recalcAgencyDay(h.query.bind(h), "2026-07-01", AGENCY_ID, BANK_ID);
    expect(n1).toBeGreaterThanOrEqual(1);
    const agg1 = await loadAgencyAggregate(h.query.bind(h), BANK_ID, AGENCY_ID, "2026-07-01", "2026-07-01");

    await recalcAgencyDay(h.query.bind(h), "2026-07-01", AGENCY_ID, BANK_ID);
    const agg2 = await loadAgencyAggregate(h.query.bind(h), BANK_ID, AGENCY_ID, "2026-07-01", "2026-07-01");
    expect(agg2).toEqual(agg1);

    // Vérifie les mesures matérialisées
    expect(agg1.ticketsIssued).toBe(6);
    expect(agg1.doneCount).toBe(4);
    expect(agg1.abandonedCount).toBe(1);
    expect(agg1.noShowCount).toBe(1);
    expect(agg1.totalWaitSeconds).toBe(2550);
    expect(agg1.totalServiceSeconds).toBe(2160);
    // occupation : available = 8h (28800s, pause exclue), active = ticket ouvert (AVAILABLE+SERVING)
    expect(agg1.agentAvailableSeconds).toBe(28800);
  });

  it("REP-001: computeAgencyKpiResponse → KpiSet + partial:false pour jour figé", async () => {
    const now = new Date("2026-07-10T09:00:00Z"); // bien après J+2 07:00 du 2026-07-01
    const resp = await computeAgencyKpiResponse(h.query.bind(h), {
      bankId: BANK_ID, agencyId: AGENCY_ID, dayStart: "2026-07-01", dayEnd: "2026-07-01", now,
    });
    expect(resp.partial).toBe(false);
    expect(resp.kpis.tmt.value).toBe(540); // 2160/4
    // SLA D2 : met=3 (DONE dans le délai) / total = appelés(DONE 4 + NO_SHOW 1) + abandon 1 = 6
    // → 3/6 = 50 % (NO_SHOW appelé sans attente valide + abandon = non-met).
    expect(resp.kpis.tauxSLA.value).toBe(50);
    expect(resp.kpis.occupation.value).toBe(100); // 28800/28800
  });

  it("REP-001: partial:true si la fenêtre inclut un jour non figé (horloge injectée)", async () => {
    const now = new Date("2026-07-01T12:00:00Z"); // jour courant
    const resp = await computeAgencyKpiResponse(h.query.bind(h), {
      bankId: BANK_ID, agencyId: AGENCY_ID, dayStart: "2026-07-01", dayEnd: "2026-07-01", now,
    });
    expect(resp.partial).toBe(true);
  });

  it("REP-001: agence sans donnée sur la période → agrégat vide, tous KPIs null (jamais 0/NaN)", async () => {
    const now = new Date("2026-09-01T09:00:00Z");
    const resp = await computeAgencyKpiResponse(h.query.bind(h), {
      bankId: BANK_ID, agencyId: AGENCY_ID, dayStart: "2026-08-01", dayEnd: "2026-08-01", now,
    });
    expect(resp.kpis.tma.value).toBeNull();
    expect(resp.kpis.nps).toBeNull();
    expect(resp.kpis.occupation.value).toBeNull();
    expect(resp.partial).toBe(false);
  });

  it("REP-001: agrégation multi-jours = somme puis division (2 jours asymétriques → pondérée exacte)", async () => {
    // Jour 07-02 : 1 DONE wait 100 ; Jour 07-03 : 3 DONE wait 300 chacun (total 900)
    await insertTicket({ status: "DONE", issuedAt: "2026-07-02T08:00:00Z", calledAt: "2026-07-02T08:01:40Z", servedAt: "2026-07-02T08:02:00Z", closedAt: "2026-07-02T08:12:00Z", wait: 100, service: 600, feedback: 5 });
    for (let i = 0; i < 3; i++) {
      await insertTicket({ status: "DONE", issuedAt: `2026-07-03T0${8 + i}:00:00Z`, calledAt: `2026-07-03T0${8 + i}:05:00Z`, servedAt: `2026-07-03T0${8 + i}:10:00Z`, closedAt: `2026-07-03T0${8 + i}:20:00Z`, wait: 300, service: 600, feedback: 5 });
    }
    await recalcAgencyDay(h.query.bind(h), "2026-07-02", AGENCY_ID, BANK_ID);
    await recalcAgencyDay(h.query.bind(h), "2026-07-03", AGENCY_ID, BANK_ID);
    const agg = await loadAgencyAggregate(h.query.bind(h), BANK_ID, AGENCY_ID, "2026-07-02", "2026-07-03");
    // TMA = (100 + 900) / (1 + 3) = 250 (pas (100+300)/2 = 200)
    expect(agg.servedCount).toBe(4);
    expect(agg.totalWaitSeconds).toBe(1000);
  });
});
