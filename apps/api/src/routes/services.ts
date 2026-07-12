/**
 * Routes services — API-008 (core.yaml).
 *
 * - GET   /services       — liste des services d'une agence (agency, MANAGER).
 * - POST  /services       — création (agency, AGENCY_DIRECTOR) + audit.
 * - PATCH /services/:id   — merge partiel SLA/ordre/statut (agency, AGENCY_DIRECTOR) + audit.
 *
 * `code` unique par agence → 409 CONFLICT. `display_order` aligné `order` du contrat.
 * L'agence cible est fournie via `?agencyId=` (validée par le middleware contre le
 * scope JWT — un DIRECTOR ciblant une agence hors scope reçoit 403).
 *
 * @module
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import {
  paramUuid,
  errorResponse,
  parseJson,
  parseStrict,
  readPagination,
  requireBankId,
  assertAgencyScope,
  UUID_RE,
} from "src/lib/admin-helpers.js";
import { recordAudit, buildDiff, extractIp } from "src/lib/audit-context.js";

/** Variables de contexte Hono du routeur services. */
interface ServiceEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Contexte Hono typé. */
type ServiceCtx = Context<ServiceEnv>;

/** Corps de POST /services (LA LOI CreateServiceRequest). */
const createServiceSchema = z
  .object({
    name: z.string().min(1),
    code: z.string().regex(/^[A-Z]{2,4}$/).optional(),
    slaMinutes: z.number().int().min(1).default(10),
    order: z.number().int().min(1).optional(),
  })
  .strict();

/** Corps de PATCH /services/:id (LA LOI UpdateServiceRequest). */
const updateServiceSchema = z
  .object({
    name: z.string().min(1).optional(),
    slaMinutes: z.number().int().min(1).optional(),
    active: z.boolean().optional(),
    order: z.number().int().min(1).optional(),
  })
  .strict();

/** Ligne brute de la table `services`. */
interface ServiceRow {
  id: string;
  bank_id: string;
  agency_id: string;
  code: string;
  name: string;
  sla_minutes: number;
  display_order: number;
  is_active: boolean;
}

/**
 * Crée le routeur services (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes services API-008
 */
export function createServiceRouter(): Hono<ServiceEnv> {
  const router = new Hono<ServiceEnv>();
  registerListServices(router);
  registerCreateService(router);
  registerPatchService(router);
  return router;
}

/** Projette une ligne `services` vers la ressource `Service` de LA LOI. */
function toService(row: ServiceRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    agencyId: row.agency_id,
    slaMinutes: row.sla_minutes,
    active: row.is_active,
    order: row.display_order,
  };
}

/** Colonnes projetées. */
const SVC_COLS =
  "id, bank_id, agency_id, code, name, sla_minutes, display_order, is_active";

/**
 * Résout l'agence cible depuis `?agencyId=` et la valide contre le scope.
 * @throws {SigfaError} 400 si absente/mal formée, 403 si hors scope.
 */
function requireAgencyId(c: ServiceCtx, tenant: TenantContext): string {
  const agencyId = c.req.query("agencyId");
  if (!agencyId || !UUID_RE.test(agencyId)) {
    throw new SigfaError("VALIDATION_ERROR", "agencyId requis.", 400);
  }
  assertAgencyScope(tenant, agencyId);
  return agencyId;
}

/** Enregistre GET /services (filtre soft-delete). */
function registerListServices(router: Hono<ServiceEnv>): void {
  router.get("/services", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const agencyId = requireAgencyId(c, tenant);
      const { page, limit, offset } = readPagination(c);
      const res = await db.query(
        `SELECT ${SVC_COLS} FROM services
          WHERE bank_id=$1 AND agency_id=$2 AND deleted_at IS NULL
          ORDER BY display_order ASC, created_at ASC LIMIT $3 OFFSET $4`,
        [bankId, agencyId, limit, offset]
      );
      const count = await db.query(
        `SELECT COUNT(*)::int AS total FROM services
          WHERE bank_id=$1 AND agency_id=$2 AND deleted_at IS NULL`,
        [bankId, agencyId]
      );
      return c.json(
        {
          data: (res.rows as ServiceRow[]).map(toService),
          meta: { page, limit, total: (count.rows[0] as { total: number }).total },
        },
        200
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre POST /services + audit. */
function registerCreateService(router: Hono<ServiceEnv>): void {
  router.post("/services", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const agencyId = requireAgencyId(c, tenant);
      const input = parseStrict(createServiceSchema, await parseJson(c));
      const created = await insertService(db, bankId, agencyId, input);
      await recordAudit({
        db,
        tenant,
        action: "POST /services",
        entityType: "service",
        entityId: created.id,
        ip: extractIp(c),
        diff: buildDiff({}, { code: created.code, name: created.name }),
      });
      return c.json(toService(created), 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Insère un service, 409 si le code existe déjà dans l'agence. */
async function insertService(
  db: Client,
  bankId: string,
  agencyId: string,
  input: z.infer<typeof createServiceSchema>
): Promise<ServiceRow> {
  const code = input.code ?? "SV";
  const dup = await db.query(
    `SELECT 1 FROM services WHERE agency_id=$1 AND code=$2 AND deleted_at IS NULL`,
    [agencyId, code]
  );
  if (dup.rows.length > 0) {
    throw new SigfaError("CONFLICT", "Code de service déjà utilisé dans l'agence.", 409);
  }
  const res = await db.query(
    `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes, display_order)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${SVC_COLS}`,
    [bankId, agencyId, code, input.name, input.slaMinutes, input.order ?? 0]
  );
  return res.rows[0] as ServiceRow;
}

/** Charge un service du tenant, ou 404. */
async function loadService(db: Client, bankId: string, id: string): Promise<ServiceRow> {
  const res = await db.query(
    `SELECT ${SVC_COLS} FROM services WHERE id=$1 AND bank_id=$2 AND deleted_at IS NULL`,
    [id, bankId]
  );
  const row = res.rows[0] as ServiceRow | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Service introuvable.", 404);
  return row;
}

/** Enregistre PATCH /services/:id (merge partiel) + audit. */
function registerPatchService(router: Hono<ServiceEnv>): void {
  router.patch("/services/:id", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      const bankId = requireBankId(tenant);
      const before = await loadService(db, bankId, id);
      assertAgencyScope(tenant, before.agency_id);
      const input = parseStrict(updateServiceSchema, await parseJson(c));
      const after = await updateService(db, bankId, id, input);
      await recordAudit({
        db,
        tenant,
        action: "PATCH /services/:id",
        entityType: "service",
        entityId: id,
        ip: extractIp(c),
        diff: buildDiff(
          { name: before.name, slaMinutes: before.sla_minutes, active: before.is_active, order: before.display_order },
          { name: after.name, slaMinutes: after.sla_minutes, active: after.is_active, order: after.display_order }
        ),
      });
      return c.json(toService(after), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Applique un merge partiel (SLA/ordre/statut/nom). */
async function updateService(
  db: Client,
  bankId: string,
  id: string,
  input: z.infer<typeof updateServiceSchema>
): Promise<ServiceRow> {
  const res = await db.query(
    `UPDATE services
        SET name = COALESCE($3, name),
            sla_minutes = COALESCE($4, sla_minutes),
            is_active = COALESCE($5, is_active),
            display_order = COALESCE($6, display_order),
            updated_at = NOW()
      WHERE id=$1 AND bank_id=$2 AND deleted_at IS NULL
      RETURNING ${SVC_COLS}`,
    [id, bankId, input.name ?? null, input.slaMinutes ?? null, input.active ?? null, input.order ?? null]
  );
  const row = res.rows[0] as ServiceRow | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Service introuvable.", 404);
  return row;
}
