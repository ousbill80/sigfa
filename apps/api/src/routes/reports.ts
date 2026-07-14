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
 * ## Sécurité (SEC-002-CUTOVER-LOT9) — SPLIT tenant/plateforme
 * - Chemins TENANT (`scope=agency`, daily, benchmark, export) : bornés à UNE banque
 *   (`requireBankId(tenant)`). TOUT accès DB est routé via `withArmedTenant` (contexte
 *   RLS `app.current_bank_id` armé sur `sigfa_app` NOBYPASSRLS). La policy
 *   `tenant_isolation` de `daily_agency_stats`/`agencies`/`export_jobs` devient
 *   contraignante → défense-en-profondeur au-delà du `WHERE bank_id` applicatif.
 * - Chemin PLATEFORME (`scope=network`, `buildNetworkResponse`) : agrégat CROSS-TENANT
 *   réseau anonymisé (SUPER_ADMIN, `AnonymizedNetworkAggregate`) qui lit
 *   `daily_agency_stats` SANS filtre `bank_id`, PAR CONCEPTION. L'ARMER restreindrait
 *   silencieusement l'agrégat à UNE banque (policy `tenant_isolation` USING
 *   `bank_id = current_bank_id`) — cassant la lecture réseau. Ce chemin passe donc par
 *   `withPlatform` (comme `network-overview.ts`), JAMAIS par un armement tenant.
 *
 * @module
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { withPlatform } from "@sigfa/database";
import { withArmedTenant, asArmable } from "src/lib/armed-tenant.js";
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
  type DailyStatsAggregate,
  type KpiSet,
  type KpiValue,
} from "src/reporting/sla-engine.js";
import {
  rankAgencies,
  DEFAULT_SORT_KPI,
  KPI_HIGHER_IS_BETTER,
  DEFAULT_THRESHOLDS,
  type SortKpi,
  type AgencyBenchmarkInput,
  type BenchmarkEntry,
} from "src/reporting/benchmark.js";
import {
  createExportJob,
  loadOwnedJob,
  type ExportJobScope,
  type ExportJobRow,
} from "src/reporting/export-job-service.js";
import type { ExportFormat } from "src/reporting/export-storage.js";

/** Enfile le build d'un job d'export (branché sur l'infra BullMQ REP-003). */
export type EnqueueExportFn = (jobId: string, bankId: string) => Promise<void>;

/** Dépendances optionnelles du routeur reports (volet export asynchrone REP-003). */
export interface ReportRouterDeps {
  /**
   * Enfile le build d'un export (BullMQ). Absent en dev/test unitaire : le job
   * reste `PENDING` jusqu'à ce qu'un worker le prenne (aucun échec côté route).
   */
  enqueueExport?: EnqueueExportFn;
}

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
 * @param deps - Dépendances optionnelles (enfileur d'export BullMQ REP-003)
 * @returns Routeur Hono des routes reporting (REP-001 + REP-003)
 */
export function createReportRouter(deps: ReportRouterDeps = {}): Hono<ReportEnv> {
  const router = new Hono<ReportEnv>();
  registerKpis(router);
  registerDailyReport(router);
  registerBenchmark(router);
  registerExport(router, deps);
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
        // PLATEFORME : agrégat cross-tenant réseau anonymisé (SUPER_ADMIN). Lit
        // `daily_agency_stats` SANS filtre `bank_id` — l'armer restreindrait à UNE
        // banque. Passe par `withPlatform` (frontière plateforme, aucun
        // `SET app.current_bank_id`), comme network-overview.ts : le 1er argument
        // (query single-arg) matérialise le périmètre plateforme ; l'agrégat
        // paramétré s'exécute via la `QueryFn` paramétrée capturée dans la clôture.
        const body = await withPlatform(
          (sql) => db.query(sql) as unknown as Promise<{ rows: Record<string, unknown>[] }>,
          () => buildNetworkResponse(asQueryFn(db), bounds, now)
        );
        return c.json(body, 200);
      }
      // TENANT : borné à la banque du JWT → accès DB armé (RLS `app.current_bank_id`).
      const bankId = requireBankId(tenant);
      const body = await withArmedTenant(asArmable(db), bankId, (conn) =>
        buildAgencyResponse(asQueryFn(conn as unknown as Client), tenant, c.req.query("agencyId"), bounds, now)
      );
      return c.json(body, 200);
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
      // TENANT : lectures armées (RLS `app.current_bank_id`) — daily_agency_stats + agencies.
      const { aggregate, agencyName } = await withArmedTenant(asArmable(db), bankId, async (conn) => {
        const query = asQueryFn(conn as unknown as Client);
        return {
          aggregate: await loadAgencyAggregate(query, bankId, agencyId, day, day),
          agencyName: await loadAgencyName(query, bankId, agencyId),
        };
      });
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/benchmark (REP-003 — classement inter-agences)
// ─────────────────────────────────────────────────────────────────────────────

/** Ensemble des KPI de tri valides (validation du paramètre `sortKpi`). */
const VALID_SORT_KPIS = new Set<string>(Object.keys(KPI_HIGHER_IS_BETTER));

/** Valide le paramètre `sortKpi` (défaut `tauxSLA`), sinon lève 400. */
function parseSortKpi(raw: string | undefined): SortKpi {
  if (raw === undefined) return DEFAULT_SORT_KPI;
  if (!VALID_SORT_KPIS.has(raw)) {
    throw new SigfaError("VALIDATION_ERROR", "Paramètre `sortKpi` invalide.", 400);
  }
  return raw as SortKpi;
}

/** Enregistre GET /reports/benchmark (classement + statut vert/orange/rouge/n-a). */
function registerBenchmark(router: Hono<ReportEnv>): void {
  router.get("/reports/benchmark", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const bounds = parsePeriodOr400(c.req.query("period"));
      const sortKpi = parseSortKpi(c.req.query("sortKpi"));
      // TENANT : lecture armée (RLS `app.current_bank_id`) — agencies + daily_agency_stats.
      const entries = await withArmedTenant(asArmable(db), bankId, (conn) =>
        buildBenchmark(asQueryFn(conn as unknown as Client), bankId, bounds, sortKpi)
      );
      return c.json(
        {
          period: bounds.periodKey,
          thresholds: {
            sla: { vert: DEFAULT_THRESHOLDS.sla.vert, orange: DEFAULT_THRESHOLDS.sla.orange },
            tma: { vert: DEFAULT_THRESHOLDS.tma.vert, orange: DEFAULT_THRESHOLDS.tma.orange },
          },
          data: entries,
          meta: { page: 1, limit: entries.length, total: entries.length },
        },
        200
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/**
 * Charge les agences du tenant + leur agrégat de période et calcule le classement.
 * Une agence sans ligne d'agrégat sur la période → `aggregate: null` → statut `n/a`.
 */
async function buildBenchmark(
  query: QueryFn,
  bankId: string,
  bounds: NonNullable<ReturnType<typeof parsePeriod>>,
  sortKpi: SortKpi
): Promise<BenchmarkEntry[]> {
  const agencies = await query(
    `SELECT id, name FROM agencies WHERE bank_id = $1 AND deleted_at IS NULL ORDER BY id`,
    [bankId]
  );
  const statsRows = await query(
    `SELECT agency_id, tickets_issued, tickets_served, tickets_abandoned, tickets_no_show,
            total_wait_seconds, total_service_seconds, sla_met_count, sla_total_count,
            feedback_count, nps_promoters, nps_passives, nps_detractors,
            agent_active_seconds, agent_available_seconds
       FROM daily_agency_stats
      WHERE bank_id = $1 AND service_id IS NULL
        AND day >= $2::date AND day <= $3::date`,
    [bankId, bounds.dayStart, bounds.dayEnd]
  );
  // Somme des agrégats par agence (multi-jours → une somme par agence).
  const byAgency = new Map<string, DailyStatsAggregate[]>();
  for (const raw of statsRows.rows) {
    const agencyId = String(raw["agency_id"]);
    const list = byAgency.get(agencyId) ?? [];
    list.push(mapRowToAggregate(raw as unknown as DailyStatsRow));
    byAgency.set(agencyId, list);
  }
  const inputs: AgencyBenchmarkInput[] = agencies.rows.map((row) => {
    const agencyId = String(row["id"]);
    const list = byAgency.get(agencyId);
    return {
      agencyId,
      agencyName: String(row["name"]),
      aggregate: list && list.length > 0 ? sumAggregates(list) : null,
    };
  });
  return rankAgencies(inputs, sortKpi, DEFAULT_THRESHOLDS);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /reports/export (202 + jobId) & GET /reports/export/:jobId (REP-003)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enregistre les routes d'export (REP-003 / CONTRACT-006) :
 *  - déclenchement asynchrone → **202 + jobId** sur `/reports/export`. Le contrat
 *    déclare la méthode `GET` (202) ; la story REP-003 exige `POST`. On expose LES
 *    DEUX (même handler) : `GET` (compatible AUDITOR lecture seule + mock contrat)
 *    et `POST` (intention story). RBAC : AGENT interdit, DIRECTOR+/AUDITOR OK.
 *  - suivi (polling) → `GET /reports/export/:jobId` (URL signée si READY).
 */
function registerExport(router: Hono<ReportEnv>, deps: ReportRouterDeps): void {
  router.post("/reports/export", async (c) => handleExportCreate(c, deps));
  router.get("/reports/export", async (c) => handleExportCreate(c, deps));
  router.get("/reports/export/:jobId", async (c) => handleExportStatus(c));
}

/** Formats d'export valides. */
const VALID_FORMATS = new Set<string>(["pdf", "xlsx", "json"]);

/**
 * POST /reports/export : crée un job `export_jobs` PENDING, enfile le build BullMQ
 * (si branché) et retourne **202 + jobId** (`ExportJobAccepted`, CONTRACT-006).
 */
async function handleExportCreate(
  c: Context<ReportEnv>,
  deps: ReportRouterDeps
): Promise<Response> {
  const db = c.get("db");
  const tenant = c.get("tenant");
  try {
    const bankId = requireBankId(tenant);
    const format = c.req.query("format");
    if (!format || !VALID_FORMATS.has(format)) {
      throw new SigfaError("VALIDATION_ERROR", "Paramètre `format` requis (pdf|xlsx|json).", 400);
    }
    const scopeParam = c.req.query("scope");
    if (scopeParam !== "agency" && scopeParam !== "network") {
      throw new SigfaError("VALIDATION_ERROR", "Paramètre `scope` requis (agency|network).", 400);
    }
    const bounds = parsePeriodOr400(c.req.query("period"));
    const scope: ExportJobScope = scopeParam;
    let agencyId: string | null = null;
    if (scope === "agency") {
      agencyId = resolveAgencyId(tenant, c.req.query("agencyId"));
      assertAgencyScope(tenant, agencyId);
    }
    // TENANT : création du job d'export armée (RLS `app.current_bank_id`) — export_jobs.
    const job = await withArmedTenant(asArmable(db), bankId, (conn) =>
      createExportJob(asQueryFn(conn as unknown as Client), {
        bankId,
        requestedBy: tenant.userId,
        scope,
        agencyId,
        periodKey: bounds.periodKey,
        format: format as ExportFormat,
      })
    );
    if (deps.enqueueExport) {
      await deps.enqueueExport(job.id, bankId);
    }
    return c.json(
      {
        jobId: job.id,
        status: "PENDING",
        format: job.format,
        scope,
        period: bounds.periodKey,
        createdAt: job.createdAt.toISOString(),
        pollingUrl: `/api/v1/reports/export/${job.id}`,
      },
      202
    );
  } catch (err) {
    return errorResponse(c, err);
  }
}

/**
 * GET /reports/export/:jobId : statut du job + URL signée si READY (et non expirée).
 * Ownership OPAQUE : un job d'un autre tenant/demandeur → 404 `EXPORT_JOB_NOT_FOUND`.
 */
async function handleExportStatus(c: Context<ReportEnv>): Promise<Response> {
  const db = c.get("db");
  const tenant = c.get("tenant");
  try {
    const bankId = requireBankId(tenant);
    const jobId = c.req.param("jobId");
    if (!jobId) {
      throw new SigfaError("EXPORT_JOB_NOT_FOUND", "Aucun job d'export trouvé avec cet identifiant.", 404);
    }
    // TENANT : lecture du job armée (RLS `app.current_bank_id`) — ownership opaque.
    const job = await withArmedTenant(asArmable(db), bankId, (conn) =>
      loadOwnedJob(asQueryFn(conn as unknown as Client), jobId, bankId, tenant.userId, tenant.role)
    );
    if (!job) {
      // 404 opaque : jamais d'oracle d'existence cross-tenant / cross-demandeur.
      throw new SigfaError("EXPORT_JOB_NOT_FOUND", "Aucun job d'export trouvé avec cet identifiant.", 404);
    }
    return c.json(buildExportStatusResponse(job, new Date()), 200);
  } catch (err) {
    return errorResponse(c, err);
  }
}

/**
 * Projette une ligne `export_jobs` en `ExportJobPollingResponse` (CONTRACT-006).
 * READY expiré → `downloadUrl:null` + erreur `EXPORT_URL_EXPIRED` (aucune URL servie).
 *
 * @param job - Ligne du job d'export
 * @param now - Horloge injectée (base de l'évaluation d'expiration)
 * @returns Corps `ExportJobPollingResponse`
 */
export function buildExportStatusResponse(
  job: ExportJobRow,
  now: Date
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    jobId: job.id,
    status: job.status,
    format: job.format,
    createdAt: job.createdAt.toISOString(),
  };
  if (job.status === "READY" && job.fileUrl && job.expiresAt) {
    const expired = now.getTime() > job.expiresAt.getTime();
    if (expired) {
      // URL signée expirée : téléchargement refusé, aucune URL servie (regénération
      // = nouvel export). Le statut reflète l'expiration.
      base["downloadUrl"] = null;
      base["expiresAt"] = job.expiresAt.toISOString();
      base["error"] = { code: "EXPORT_URL_EXPIRED", message: "Lien de téléchargement expiré." };
      return base;
    }
    base["downloadUrl"] = job.fileUrl;
    base["expiresAt"] = job.expiresAt.toISOString();
    base["completedAt"] = job.updatedAt.toISOString();
  }
  if (job.status === "FAILED") {
    base["error"] = { code: "EXPORT_GENERATION_FAILED", message: "La génération de l'export a échoué." };
  }
  return base;
}
