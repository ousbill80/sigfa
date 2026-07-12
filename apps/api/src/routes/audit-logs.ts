/**
 * Route de consultation du journal d'audit — API-011 (admin.yaml `GET /audit-logs`).
 *
 * LECTURE SEULE STRICTE (AUDITOR | SUPER_ADMIN — MANAGER → 403 par le RBAC).
 * Aucune mutation n'est exposée : la table `audit_log` est append-only en base.
 *
 * Filtres LA LOI : `entityType`, `entityId`, `actorId`, `from`, `to` + pagination
 * `page`/`limit`. Mapping DB → API :
 *  - `occurred_at`                          → `timestamp`
 *  - `actor_id` / `actor_role` / `actor_email` → objet `actor` composé
 *  - `entity_type` / `entity_id`            → champs `entityType` / `entityId`
 *
 * Scope : un AUDITOR est rattaché à une banque (`bankId` du JWT) → ses lectures sont
 * bornées à cette banque. Un SUPER_ADMIN (`bankId` null) lit toutes les banques.
 *
 * @module
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import type { TenantContext } from "src/middleware/tenant.js";
import { errorResponse, readPagination } from "src/lib/admin-helpers.js";

/** Variables de contexte Hono du routeur audit-logs. */
interface AuditEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Schéma des filtres de query (tous optionnels, LA LOI). */
const filterSchema = z.object({
  entityType: z.string().min(1).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** Ligne brute projetée de `audit_log`. */
interface AuditRow {
  actor_id: string | null;
  actor_role: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  occurred_at: Date;
  ip: string | null;
  diff: Record<string, unknown> | null;
}

/**
 * Crée le routeur audit-logs (monté sous /api/v1).
 *
 * @returns Routeur Hono de `GET /audit-logs`
 */
export function createAuditLogRouter(): Hono<AuditEnv> {
  const router = new Hono<AuditEnv>();
  router.get("/audit-logs", async (c) => {
    try {
      const filters = parseFilters(c.req.query());
      const { page, limit, offset } = readPagination(c);
      const bankId = c.get("tenant").bankId;
      const { where, params } = buildWhere(filters, bankId);
      const db = c.get("db");
      const rows = await db.query(
        `SELECT actor_id, actor_role, actor_email, action, entity_type, entity_id,
                occurred_at, ip, diff
           FROM audit_log ${where}
          ORDER BY occurred_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      const count = await db.query(
        `SELECT COUNT(*)::int AS total FROM audit_log ${where}`,
        params
      );
      return c.json(
        {
          data: (rows.rows as AuditRow[]).map(toAuditEntry),
          meta: { page, limit, total: (count.rows[0] as { total: number }).total },
        },
        200
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
  return router;
}

/**
 * Valide et normalise les filtres de query. Un filtre malformé est ignoré
 * silencieusement (jamais de 5xx) — la lecture reste tolérante.
 *
 * @param query - Query params bruts
 * @returns Filtres validés (partiels)
 */
function parseFilters(query: Record<string, string>): z.infer<typeof filterSchema> {
  const parsed = filterSchema.safeParse(query);
  return parsed.success ? parsed.data : {};
}

/**
 * Construit la clause WHERE paramétrée depuis les filtres + le scope tenant.
 *
 * @param filters - Filtres validés
 * @param bankId  - Banque du JWT (null pour SUPER_ADMIN → toutes banques)
 * @returns Clause `WHERE ...` et ses paramètres positionnels
 */
function buildWhere(
  filters: z.infer<typeof filterSchema>,
  bankId: string | null
): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (bankId) push(clauses, params, "bank_id =", bankId);
  if (filters.entityType) push(clauses, params, "entity_type =", filters.entityType);
  if (filters.entityId) push(clauses, params, "entity_id =", filters.entityId);
  if (filters.actorId) push(clauses, params, "actor_id =", filters.actorId);
  if (filters.from) push(clauses, params, "occurred_at >=", filters.from);
  if (filters.to) push(clauses, params, "occurred_at <=", filters.to);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

/**
 * Ajoute une condition paramétrée `<col> <op> $n` à la liste.
 *
 * @param clauses - Accumulateur de clauses
 * @param params  - Accumulateur de paramètres
 * @param prefix  - `<colonne> <opérateur>` (ex. `bank_id =`)
 * @param value   - Valeur liée
 */
function push(clauses: string[], params: unknown[], prefix: string, value: unknown): void {
  params.push(value);
  clauses.push(`${prefix} $${params.length}`);
}

/**
 * Projette une ligne `audit_log` vers l'entrée `AuditLog` de LA LOI (mapping
 * DB → API : acteur composé, `occurred_at` → `timestamp`).
 *
 * @param row - Ligne brute
 * @returns Entrée d'audit conforme au contrat
 */
function toAuditEntry(row: AuditRow): Record<string, unknown> {
  return {
    actor: {
      id: row.actor_id ?? "",
      role: row.actor_role ?? "",
      ...(row.actor_email ? { email: row.actor_email } : {}),
    },
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id ?? "",
    timestamp: row.occurred_at.toISOString(),
    ip: row.ip ?? "",
    ...(row.diff ? { diff: row.diff } : {}),
  };
}
