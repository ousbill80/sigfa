/**
 * IA-003 — Routeur `GET /ai/anomalies` (CONTRACT-008).
 *
 * Implémente la surface DÉJÀ contractualisée par CONTRACT-008 (la story
 * implémente, elle n'étend pas le contrat). Liste PAGINÉE des anomalies agrégées
 * du tenant, filtrable par `status` et `agencyId`, projetée à la forme
 * `AnomaliesListResponse` (dualité `meta`/`aiMeta`, CONTRACT-010) avec `evidence`
 * structurée (CONTRACT-013).
 *
 * ## Lecture seule — ZÉRO action corrective (garde-fou)
 * Ce routeur LIT `ai_anomalies` et projette ; il n'émet AUCUNE mutation
 * opérationnelle. L'acquittement (`POST /ai/anomalies/:id/ack`) est HORS scope de
 * cette story (implémenté séparément).
 *
 * ## Isolation tenant (SEC-002 — ARMÉE)
 * Le filtre `bank_id` provient du contexte tenant (JWT) — jamais du client.
 * Un tenant ne voit JAMAIS les anomalies d'une autre banque. La lecture
 * `ai_anomalies` passe désormais par `withArmedTenant` (`app.current_bank_id`
 * armé, connexion `sigfa_app` NOBYPASSRLS) : la policy `tenant_isolation`
 * (DB-007) devient réellement contraignante en défense-en-profondeur — l'isolation
 * ne repose plus sur le seul `WHERE bank_id` applicatif. Cette route est classée
 * `ARMED` dans le test d'architecture.
 *
 * ## Note d'intégration (GATED runtime)
 * L'implémentation runtime de la détection est GATED sur données réelles ; ce
 * routeur expose la surface de lecture. La projection (`projectAnomalyRow`) est
 * PURE et entièrement testée hors DB.
 *
 * @module
 */

import { Hono } from "hono";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import {
  errorResponse,
  readPagination,
  requireBankId,
  assertAgencyScope,
  type Pagination,
} from "src/lib/admin-helpers.js";
import { asArmable, withArmedTenant } from "src/lib/armed-tenant.js";
import { ANOMALY_TYPES, type AnomalyType, type AnomalyEvidence } from "src/ai/anomaly-detectors.js";

/** Version de modèle exposée dans `aiMeta` pour les anomalies (CONTRACT-008). */
export const ANOMALY_MODEL_VERSION = "anomaly-v1.0.0" as const;

/** Statuts valides du filtre `status` (énum FERMÉE CONTRACT-008). */
const ANOMALY_STATUSES = ["open", "acked", "resolved"] as const;
/** Statut d'anomalie (union fermée). */
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number];

/** Ligne brute `ai_anomalies` (colonnes snake_case pg). */
export interface AnomalyRow {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly agency_id: string | null;
  readonly payload: unknown;
  readonly detected_at: Date | string;
  readonly acked_by: string | null;
  readonly acked_at: Date | string | null;
  readonly resolved_at: Date | string | null;
}

/** Variables de contexte Hono du routeur anomalies. */
interface AnomalyEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Garde de type : la valeur est un `AnomalyType` de l'énum fermée. */
function isAnomalyType(value: unknown): value is AnomalyType {
  return typeof value === "string" && (ANOMALY_TYPES as readonly string[]).includes(value);
}

/** Garde de type : la valeur est un `AnomalyStatus` de l'énum fermée. */
function isAnomalyStatus(value: unknown): value is AnomalyStatus {
  return typeof value === "string" && (ANOMALY_STATUSES as readonly string[]).includes(value);
}

/** Normalise une date (Date|string) en ISO 8601 UTC, ou undefined si null. */
function toIso(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Extrait les preuves structurées (`evidence`, CONTRACT-013) d'un `payload` JSONB,
 * en ne conservant QUE les entrées bien formées (metric/threshold/window/sample).
 * Aucune preuve → tableau vide (champ omis à la projection).
 */
export function extractEvidence(payload: unknown): AnomalyEvidence[] {
  if (typeof payload !== "object" || payload === null) return [];
  const raw = (payload as Record<string, unknown>)["evidence"];
  if (!Array.isArray(raw)) return [];
  const out: AnomalyEvidence[] = [];
  for (const e of raw) {
    if (typeof e !== "object" || e === null) continue;
    const rec = e as Record<string, unknown>;
    if (
      typeof rec["metric"] === "string" &&
      typeof rec["threshold"] === "number" &&
      typeof rec["window"] === "string" &&
      typeof rec["sample"] === "number"
    ) {
      out.push({
        metric: rec["metric"],
        threshold: rec["threshold"],
        window: rec["window"],
        sample: rec["sample"],
      });
    }
  }
  return out;
}

/** Lit une chaîne optionnelle d'un payload JSONB (UUID technique, jamais PII). */
function payloadString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

/** Lit un nombre optionnel d'un payload JSONB. */
function payloadNumber(payload: unknown, key: string): number | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * Projette une ligne `ai_anomalies` vers la ressource contractuelle `Anomaly`
 * (CONTRACT-008 + evidence CONTRACT-013). Fonction PURE, testable hors DB.
 *
 * @param row       - Ligne brute `ai_anomalies`
 * @param dataWindow - Fenêtre de données ISO 8601 (`YYYY-MM-DD/YYYY-MM-DD`)
 * @param computedAt - Horodatage ISO du calcul (aiMeta)
 * @returns Ressource `Anomaly` conforme au contrat
 */
export function projectAnomalyRow(
  row: AnomalyRow,
  dataWindow: string,
  computedAt: string
): Record<string, unknown> {
  if (!isAnomalyType(row.type)) {
    // Défense : l'énum DB garantit déjà la valeur ; on ne projette jamais un type hors contrat.
    throw new SigfaError("INTERNAL_SERVER_ERROR", "Type d'anomalie hors contrat.", 500);
  }
  const evidence = extractEvidence(row.payload);
  const agentId = payloadString(row.payload, "agentId");
  const serviceId = payloadString(row.payload, "serviceId");
  const description = payloadString(row.payload, "description") ?? "";
  const alertCount = payloadNumber(row.payload, "alertCount");
  const windowDays = payloadNumber(row.payload, "windowDays");
  const ackedAt = toIso(row.acked_at);
  const resolvedAt = toIso(row.resolved_at);

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    ...(row.agency_id !== null ? { agencyId: row.agency_id } : {}),
    ...(agentId !== undefined ? { agentId } : {}),
    ...(serviceId !== undefined ? { serviceId } : {}),
    description,
    detectedAt: toIso(row.detected_at)!,
    ...(ackedAt !== undefined ? { ackedAt } : {}),
    ...(row.acked_by !== null ? { ackedBy: row.acked_by } : {}),
    ...(resolvedAt !== undefined ? { resolvedAt } : {}),
    ...(alertCount !== undefined ? { alertCount } : {}),
    ...(windowDays !== undefined ? { windowDays } : {}),
    ...(evidence.length > 0 ? { evidence } : {}),
    meta: {
      modelVersion: ANOMALY_MODEL_VERSION,
      computedAt,
      dataWindow,
    },
  };
}

/**
 * Parse et valide le filtre `status` (défaut `open`, CONTRACT-008).
 *
 * @param raw - Valeur brute de la query
 * @returns Statut valide
 * @throws SigfaError 400 si valeur hors énum
 */
export function parseStatusFilter(raw: string | undefined): AnomalyStatus {
  if (raw === undefined) return "open";
  if (!isAnomalyStatus(raw)) {
    throw new SigfaError(
      "VALIDATION_ERROR",
      "Paramètre `status` invalide (open|acked|resolved).",
      400
    );
  }
  return raw;
}

/**
 * Fonction de requête SQL paramétrée minimale (adaptée du `Client` pg).
 * Testable hors DB par injection d'un stub — la couche route reste PURE de driver.
 */
export type QueryFn = (
  sql: string,
  values?: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>> }>;

/**
 * Connexion pg minimale requise par `asQueryFn` : un `query(sql, values?)`.
 * Un `Client` pg comme une connexion ARMÉE (`withArmedTenant`) la satisfont.
 */
interface QueryableConnection {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Adapte une connexion pg (Client ou armée) en `QueryFn`. */
export function asQueryFn(db: QueryableConnection): QueryFn {
  return (sql, values) =>
    db.query(sql, values).then((r) => ({ rows: r.rows as Array<Record<string, unknown>> }));
}

/**
 * Charge les lignes d'anomalies du tenant (paginées, filtrées status/agency).
 * `bank_id` provient du tenant (jamais du client) → isolation garantie.
 *
 * @param query    - Fonction de requête (pg réel ou stub de test)
 * @param bankId   - Tenant (issu du JWT, jamais du client)
 * @param status   - Statut filtré (open|acked|resolved)
 * @param agencyId - Agence filtrée (optionnelle)
 * @param page     - Pagination effective
 * @returns Lignes + total pré-pagination
 */
export async function loadAnomalies(
  query: QueryFn,
  bankId: string,
  status: AnomalyStatus,
  agencyId: string | undefined,
  page: Pagination
): Promise<{ rows: AnomalyRow[]; total: number }> {
  const filters: string[] = ["bank_id = $1", "status = $2"];
  const values: unknown[] = [bankId, status];
  if (agencyId !== undefined) {
    values.push(agencyId);
    filters.push(`agency_id = $${values.length}`);
  }
  const where = filters.join(" AND ");

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM ai_anomalies WHERE ${where}`,
    values
  );
  const total = (countRes.rows[0] as { total: number } | undefined)?.total ?? 0;

  const limitIdx = values.length + 1;
  const offsetIdx = values.length + 2;
  const listRes = await query(
    `SELECT id, type, status, agency_id, payload, detected_at, acked_by, acked_at, resolved_at
       FROM ai_anomalies
      WHERE ${where}
      ORDER BY detected_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...values, page.limit, page.offset]
  );
  return { rows: listRes.rows as unknown as AnomalyRow[], total };
}

/**
 * Construit la réponse `AnomaliesListResponse` (data + meta + aiMeta).
 * Fonction PURE : projette des lignes déjà chargées + la pagination.
 *
 * @param rows       - Lignes brutes `ai_anomalies`
 * @param total      - Total d'anomalies matchant (pré-pagination)
 * @param page       - Pagination effective
 * @param dataWindow - Fenêtre de données ISO 8601
 * @param computedAt - Horodatage ISO du calcul
 * @returns Réponse conforme `AnomaliesListResponse`
 */
export function buildAnomaliesResponse(
  rows: readonly AnomalyRow[],
  total: number,
  page: Pagination,
  dataWindow: string,
  computedAt: string
): Record<string, unknown> {
  return {
    data: rows.map((r) => projectAnomalyRow(r, dataWindow, computedAt)),
    meta: { page: page.page, limit: page.limit, total },
    aiMeta: {
      modelVersion: ANOMALY_MODEL_VERSION,
      computedAt,
      dataWindow,
    },
  };
}

/** Calcule la fenêtre `dataWindow` ISO 8601 des 7 derniers jours à `now`. */
export function computeDataWindow(now: Date): string {
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `${start}/${end}`;
}

/**
 * Crée le routeur anomalies (monté sous /api/v1) — `GET /ai/anomalies`.
 *
 * @returns Routeur Hono des anomalies IA-003 (CONTRACT-008)
 */
export function createAnomalyRouter(): Hono<AnomalyEnv> {
  const router = new Hono<AnomalyEnv>();
  router.get("/ai/anomalies", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      // Garde : si le contexte tenant/db est absent (route non authentifiée), 401.
      if (!tenant || !db) {
        throw new SigfaError("UNAUTHORIZED", "Authentification requise.", 401);
      }
      const bankId = requireBankId(tenant);
      const status = parseStatusFilter(c.req.query("status"));
      const agencyIdParam = c.req.query("agencyId");
      if (agencyIdParam !== undefined) assertAgencyScope(tenant, agencyIdParam);
      const page = readPagination(c);
      const now = new Date();
      const dataWindow = computeDataWindow(now);
      const computedAt = now.toISOString();
      // SEC-002 : lecture tenant à travers la connexion ARMÉE (RLS contraignante).
      const { rows, total } = await withArmedTenant(asArmable(db), bankId, (conn) =>
        loadAnomalies(asQueryFn(conn), bankId, status, agencyIdParam, page)
      );
      return c.json(buildAnomaliesResponse(rows, total, page, dataWindow, computedAt), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
  return router;
}
