/**
 * IA-004 — Routeur `GET /ai/feedback-insights` (CONTRACT-008).
 *
 * Expose les insights NLP anonymisés des feedbacks clients pour une agence
 * (AGENCY_DIRECTOR) ou la vue réseau (BANK_ADMIN). RBAC + tenant assurés par le
 * middleware global (rbac-route-map connaît déjà `/ai/feedback-insights`) ; ce
 * routeur ne fait que lire, agréger (via `feedback-insights-service`) et projeter
 * la forme contractuelle. **Lecture seule** — aucune mutation.
 *
 * ## Isolation tenant (SEC-002 — ARMÉE)
 * La lecture des feedbacks (`tickets`, via `feedback-insights-service`) passe par
 * `withArmedTenant` (`app.current_bank_id` armé, connexion `sigfa_app` NOBYPASSRLS) :
 * la policy `tenant_isolation` de `tickets` (DB-001) devient réellement contraignante
 * en défense-en-profondeur — l'isolation ne repose plus sur le seul `WHERE bank_id`
 * du service. Cette route est classée `ARMED` dans le test d'architecture. Le
 * service `feedback-insights-service` reste INCHANGÉ : il exécute son SQL sur la
 * connexion armée que le routeur lui injecte.
 *
 * @module
 */

import { Hono } from "hono";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import { errorResponse, requireBankId, assertAgencyScope } from "src/lib/admin-helpers.js";
import { asArmable, withArmedTenant } from "src/lib/armed-tenant.js";
import { parsePeriod } from "src/reporting/period.js";
import type { QueryFn } from "src/reporting/aggregate-service.js";
import {
  computeFeedbackInsights,
  type InsightsQuery,
} from "src/ai/feedback-insights-service.js";

/** Variables de contexte Hono du routeur feedback-insights. */
interface FeedbackInsightsEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/**
 * Connexion pg minimale requise par `asQueryFn` : un `query(sql, values?)`.
 * Un `Client` pg comme une connexion ARMÉE (`withArmedTenant`) la satisfont.
 */
interface QueryableConnection {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Adapte une connexion pg (Client ou armée) en `QueryFn` paramétrée. */
function asQueryFn(db: QueryableConnection): QueryFn {
  return (sql: string, values?: unknown[]) =>
    db.query(sql, values).then((r) => ({ rows: r.rows as Array<Record<string, unknown>> }));
}

/**
 * Résout l'agence cible en scope agence : query param (validé en scope par le
 * middleware tenant), sinon la seule agence liée au JWT.
 */
function resolveAgencyId(tenant: TenantContext, agencyIdParam: string | undefined): string {
  if (agencyIdParam) return agencyIdParam;
  if (tenant.agencyIds.length === 1) return tenant.agencyIds[0]!;
  throw new SigfaError(
    "VALIDATION_ERROR",
    "Paramètre `agencyId` requis (aucune agence unique liée au JWT).",
    400
  );
}

/**
 * Construit la description d'extraction depuis la requête HTTP (scope, période,
 * agence) en appliquant les gardes RBAC/tenant locales.
 */
function buildInsightsQuery(
  tenant: TenantContext,
  scopeParam: string | undefined,
  periodParam: string | undefined,
  agencyIdParam: string | undefined,
  now: Date
): InsightsQuery {
  const bankId = requireBankId(tenant);
  const scope = scopeParam === "bank" ? "bank" : "agency";
  const bounds = periodParam ? parsePeriod(periodParam) : null;
  if (!bounds) {
    throw new SigfaError(
      "VALIDATION_ERROR",
      "Paramètre `period` invalide (ISO 8601 : YYYY, YYYY-MM, YYYY-Qn, YYYY-MM-DD).",
      400
    );
  }
  if (scope === "bank") {
    return {
      bankId,
      scope: "bank",
      dayStart: bounds.dayStart,
      dayEnd: bounds.dayEnd,
      periodKey: bounds.periodKey,
      now,
    };
  }
  const agencyId = resolveAgencyId(tenant, agencyIdParam);
  assertAgencyScope(tenant, agencyId);
  return {
    bankId,
    scope: "agency",
    agencyId,
    dayStart: bounds.dayStart,
    dayEnd: bounds.dayEnd,
    periodKey: bounds.periodKey,
    now,
  };
}

/**
 * Fabrique le routeur `GET /ai/feedback-insights`.
 *
 * @returns Routeur Hono montable via `route-registry.ts`.
 */
export function createFeedbackInsightsRouter(): Hono<FeedbackInsightsEnv> {
  const router = new Hono<FeedbackInsightsEnv>();
  router.get("/ai/feedback-insights", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const q = buildInsightsQuery(
        tenant,
        c.req.query("scope"),
        c.req.query("period"),
        c.req.query("agencyId"),
        new Date()
      );
      // SEC-002 : lecture tenant (`tickets`) à travers la connexion ARMÉE. Le
      // service `feedback-insights-service` reçoit la connexion armée, INCHANGÉ.
      const body = await withArmedTenant(asArmable(db), q.bankId, (conn) =>
        computeFeedbackInsights(asQueryFn(conn), q)
      );
      return c.json(body, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
  return router;
}
