/**
 * REP-001 — Routeur reporting KPI (CONTRACT-006).
 *
 * - GET /reports/kpis?scope=agency|network&period=… — 7 KPIs + `partial`.
 *   - scope=agency  : KPIs d'une agence (AUDITOR / AGENCY_DIRECTOR+).
 *   - scope=network : `AnonymizedNetworkAggregate`, zéro donnée personnelle (SUPER_ADMIN).
 * - GET /reports/daily/:agencyId?date=YYYY-MM-DD — rapport journalier d'une agence.
 *
 * Le moteur de calcul est PUR (`sla-engine`) ; ce routeur ne fait que lire les
 * agrégats matérialisés `daily_agency_stats` (via `aggregate-service`) et projeter
 * la forme contractuelle. RBAC/tenant assurés par le middleware + les gardes locales.
 *
 * @module
 */

import { Hono } from "hono";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import {
  paramUuid,
  errorResponse,
  requireBankId,
  assertAgencyScope,
} from "src/lib/admin-helpers.js";
import { parsePeriod } from "src/reporting/period.js";
import {
  computeAgencyKpiResponse,
  loadAgencyAggregate,
  mapRowToAggregate,
  type QueryFn,
  type DailyStatsRow,
} from "src/reporting/aggregate-service.js";
import {
  computeKpiSet,
  sumAggregates,
  toAbidjanDay,
  isDayPartial,
  type KpiSet,
  type KpiValue,
} from "src/reporting/sla-engine.js";

/** Variables de contexte Hono du routeur reports. */
interface ReportEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Adapte le `Client` pg en `QueryFn` paramétrée. */
function asQueryFn(db: Client): QueryFn {
  return (sql: string, values?: unknown[]) =>
    db.query(sql, values).then((r) => ({ rows: r.rows as Array<Record<string, unknown>> }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversion d'unité à la FRONTIÈRE ROUTE (API-First : le contrat fait loi)
//
// Le moteur pur (`sla-engine`) calcule TMA/TMT/TTS en SECONDES (source
// `total_wait_seconds` / `total_service_seconds`). Le contrat CONTRACT-006
// `KpiValue.unit` n'admet que `minutes|percent|score` : la valeur EXPOSÉE doit
// donc être en minutes pour que `unit:"minutes"` soit VRAI. On convertit ici,
// à la sortie route, sans jamais toucher le moteur (qui reste en secondes).
// ─────────────────────────────────────────────────────────────────────────────

/** Secondes par minute (conversion durée → minutes exposées). */
const SECONDS_PER_MINUTE = 60;

/** Convertit une durée en secondes vers des minutes (1 décimale) ; `null` inchangé. */
function secondsToMinutes(seconds: number | null): number | null {
  if (seconds === null) return null;
  return Math.round((seconds / SECONDS_PER_MINUTE) * 10) / 10;
}

/** Convertit un `KpiValue` de durée (secondes moteur) en minutes exposées. */
function timeKpiToMinutes(kpi: KpiValue): KpiValue {
  return { value: secondsToMinutes(kpi.value), unit: "minutes" };
}

/**
 * Projette un `KpiSet` moteur (TMA/TMT/TTS en secondes) vers la forme
 * contractuelle exposée : durées converties en minutes (`unit:"minutes"` VRAI),
 * KPIs `percent` (abandon/SLA/occupation) et `score` (NPS) inchangés.
 */
function projectKpiSet(kpis: KpiSet): KpiSet {
  return {
    tma: timeKpiToMinutes(kpis.tma),
    tmt: timeKpiToMinutes(kpis.tmt),
    tts: timeKpiToMinutes(kpis.tts),
    tauxAbandon: kpis.tauxAbandon,
    tauxSLA: kpis.tauxSLA,
    nps: kpis.nps,
    occupation: kpis.occupation,
  };
}

/**
 * Crée le routeur reports (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes reporting (REP-001)
 */
export function createReportRouter(): Hono<ReportEnv> {
  const router = new Hono<ReportEnv>();
  registerKpis(router);
  registerDailyReport(router);
  return router;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/kpis
// ─────────────────────────────────────────────────────────────────────────────

/** Enregistre GET /reports/kpis (scope agency|network). */
function registerKpis(router: Hono<ReportEnv>): void {
  router.get("/reports/kpis", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const scope = c.req.query("scope");
      if (scope !== "agency" && scope !== "network") {
        throw new SigfaError("VALIDATION_ERROR", "Paramètre `scope` requis (agency|network).", 400);
      }
      const bounds = parsePeriodOr400(c.req.query("period"));
      const now = new Date();
      if (scope === "network") {
        return c.json(await buildNetworkResponse(asQueryFn(db), bounds, now), 200);
      }
      return c.json(await buildAgencyResponse(asQueryFn(db), tenant, c.req.query("agencyId"), bounds, now), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Parse la période ou lève 400. */
function parsePeriodOr400(period: string | undefined): ReturnType<typeof parsePeriod> & object {
  const bounds = period ? parsePeriod(period) : null;
  if (!bounds) {
    throw new SigfaError("VALIDATION_ERROR", "Paramètre `period` invalide (ISO 8601 : YYYY, YYYY-MM, YYYY-Qn, YYYY-MM-DD).", 400);
  }
  return bounds;
}

/** Construit la réponse KPI d'agence (scope=agency). */
async function buildAgencyResponse(
  query: QueryFn,
  tenant: TenantContext,
  agencyIdParam: string | undefined,
  bounds: NonNullable<ReturnType<typeof parsePeriod>>,
  now: Date
): Promise<Record<string, unknown>> {
  const bankId = requireBankId(tenant);
  const agencyId = resolveAgencyId(tenant, agencyIdParam);
  assertAgencyScope(tenant, agencyId);
  const response = await computeAgencyKpiResponse(query, {
    bankId,
    agencyId,
    dayStart: bounds.dayStart,
    dayEnd: bounds.dayEnd,
    now,
  });
  return {
    scope: "agency",
    period: bounds.periodKey,
    agencyId,
    kpis: projectKpiSet(response.kpis),
    partial: response.partial,
    periodMeta: buildPeriodMeta(bounds),
  };
}

/**
 * Résout l'agence cible : query param (déjà validé en scope par le middleware
 * tenant pour les routes agency-scoped), sinon la seule agence liée au JWT.
 */
function resolveAgencyId(tenant: TenantContext, agencyIdParam: string | undefined): string {
  if (agencyIdParam) return agencyIdParam;
  if (tenant.agencyIds.length === 1) return tenant.agencyIds[0]!;
  throw new SigfaError("VALIDATION_ERROR", "Paramètre `agencyId` requis (aucune agence unique liée au JWT).", 400);
}

/**
 * Construit la réponse réseau anonymisée (scope=network) : SOMME de TOUS les
 * agrégats toutes-services de la période, exposée en `AnonymizedNetworkAggregate`
 * (aucune donnée personnelle, aucun identifiant d'agence/banque).
 */
async function buildNetworkResponse(
  query: QueryFn,
  bounds: NonNullable<ReturnType<typeof parsePeriod>>,
  now: Date
): Promise<Record<string, unknown>> {
  const res = await query(
    `SELECT tickets_issued, tickets_served, tickets_abandoned, tickets_no_show,
            total_wait_seconds, total_service_seconds, sla_met_count, sla_total_count,
            feedback_count, nps_promoters, nps_passives, nps_detractors,
            agent_active_seconds, agent_available_seconds,
            agency_id
       FROM daily_agency_stats
      WHERE service_id IS NULL AND day >= $1::date AND day <= $2::date`,
    [bounds.dayStart, bounds.dayEnd]
  );
  const rows = res.rows as Array<Record<string, unknown>>;
  const aggregate = sumAggregates(rows.map((r) => mapRowToAggregate(r as unknown as DailyStatsRow)));
  const agencySet = new Set(rows.map((r) => String(r["agency_id"])));
  const kpis = computeKpiSet(aggregate);
  return {
    scope: "network",
    period: bounds.periodKey,
    aggregate: {
      totalTickets: aggregate.ticketsIssued,
      // Durées exposées en MINUTES (frontière route) — le moteur les calcule en secondes.
      avgTma: secondsToMinutes(kpis.tma.value) ?? 0,
      avgTmt: secondsToMinutes(kpis.tmt.value) ?? 0,
      avgTts: secondsToMinutes(kpis.tts.value) ?? 0,
      avgTauxAbandon: kpis.tauxAbandon.value ?? 0,
      avgTauxSLA: kpis.tauxSLA.value ?? 0,
      avgOccupation: kpis.occupation.value ?? 0,
      agencyCount: agencySet.size,
    },
    partial: isDayPartial(bounds.dayEnd, now),
    periodMeta: buildPeriodMeta(bounds),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/daily/:agencyId
// ─────────────────────────────────────────────────────────────────────────────

/** Enregistre GET /reports/daily/:agencyId. */
function registerDailyReport(router: Hono<ReportEnv>): void {
  router.get("/reports/daily/:agencyId", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const agencyId = paramUuid(c, "agencyId");
      assertAgencyScope(tenant, agencyId);
      const day = resolveDay(c.req.query("date"));
      const now = new Date();
      const query = asQueryFn(db);
      const aggregate = await loadAgencyAggregate(query, bankId, agencyId, day, day);
      const agencyName = await loadAgencyName(query, bankId, agencyId);
      return c.json(
        {
          agencyId,
          ...(agencyName !== null ? { agencyName } : {}),
          date: day,
          kpis: projectKpiSet(computeKpiSet(aggregate)),
          totalTickets: aggregate.ticketsIssued,
          peakHour: null,
          slaAlerts: [],
          partial: isDayPartial(day, now),
        },
        200
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Jour du rapport : `date` fournie (validée), sinon hier (jour Abidjan). */
function resolveDay(dateParam: string | undefined): string {
  if (dateParam) {
    const bounds = parsePeriod(dateParam);
    if (!bounds || bounds.dayStart !== bounds.dayEnd) {
      throw new SigfaError("VALIDATION_ERROR", "Paramètre `date` invalide (YYYY-MM-DD).", 400);
    }
    return bounds.dayStart;
  }
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return toAbidjanDay(yesterday);
}

/** Charge le nom d'agence du tenant (null si introuvable — pas de fuite cross-tenant). */
async function loadAgencyName(query: QueryFn, bankId: string, agencyId: string): Promise<string | null> {
  const res = await query(`SELECT name FROM agencies WHERE id = $1 AND bank_id = $2`, [agencyId, bankId]);
  const row = res.rows[0] as { name?: string } | undefined;
  return row?.name ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Construit les métadonnées de période (PeriodMeta) en bornes jour Abidjan. */
function buildPeriodMeta(bounds: NonNullable<ReturnType<typeof parsePeriod>>): Record<string, unknown> {
  // Abidjan = UTC+00 : début inclus = dayStart 00:00 ; fin exclue = lendemain de dayEnd 00:00.
  const endExclusive = new Date(`${bounds.dayEnd}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return {
    periodKey: bounds.periodKey,
    start: `${bounds.dayStart}T00:00:00+00:00`,
    end: endExclusive.toISOString().replace(".000Z", "+00:00"),
    timezone: "Africa/Abidjan",
  };
}
