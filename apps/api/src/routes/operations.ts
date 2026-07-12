/**
 * Routes opérations — MODEL-API-A (core.yaml, entité enfant d'un service).
 *
 * - GET    /services/:serviceId/operations — liste paginée (agency, MANAGER).
 * - POST   /services/:serviceId/operations — création (agency, AGENCY_DIRECTOR) + audit.
 * - GET    /operations/:id                 — détail (agency, AGENCY_DIRECTOR).
 * - PATCH  /operations/:id                 — merge partiel (agency, AGENCY_DIRECTOR) + audit.
 * - DELETE /operations/:id                 — suppression (agency, AGENCY_DIRECTOR) + audit.
 *
 * `code` regex `^[A-Z0-9]{2,6}$` UNIQUE PAR SERVICE → 409 OPERATION_CODE_DUPLICATE.
 * `slaMinutes` NULLABLE : null → hérite du SLA du service (D4). AUCUNE priorité (D4).
 * Le service parent hors scope tenant → 404 SERVICE_NOT_FOUND (opaque cross-tenant).
 * Opération inconnue/hors tenant → 404 OPERATION_NOT_FOUND.
 *
 * @module
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { SigfaError } from "src/lib/errors.js";
import { safeText } from "src/lib/safe-text.js";
import type { TenantContext } from "src/middleware/tenant.js";
import {
  paramUuid,
  errorResponse,
  parseJson,
  parseStrict,
  readPagination,
  requireBankId,
  assertAgencyScope,
} from "src/lib/admin-helpers.js";
import { recordAudit, buildDiff, extractIp } from "src/lib/audit-context.js";

/** Variables de contexte Hono du routeur operations. */
interface OperationEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Regex code opération (LA LOI `^[A-Z0-9]{2,6}$`). */
const OP_CODE_RE = /^[A-Z0-9]{2,6}$/;

/** Corps de POST /services/:serviceId/operations (LA LOI CreateOperationRequest). */
const createOperationSchema = z
  .object({
    code: z.string().regex(OP_CODE_RE),
    name: safeText().min(1),
    slaMinutes: z.number().int().min(1).nullish(),
    displayOrder: z.number().int().min(0),
    isActive: z.boolean().optional(),
    iconKey: safeText().min(1).optional(),
  })
  .strict();

/** Corps de PATCH /operations/:id (LA LOI UpdateOperationRequest — tous optionnels). */
const updateOperationSchema = z
  .object({
    code: z.string().regex(OP_CODE_RE).optional(),
    name: safeText().min(1).optional(),
    slaMinutes: z.number().int().min(1).nullish(),
    displayOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    iconKey: safeText().min(1).nullish(),
  })
  .strict();

/** Ligne brute de la table `operations`. */
interface OperationRow {
  id: string;
  bank_id: string;
  agency_id: string;
  service_id: string;
  code: string;
  name: string;
  sla_minutes: number | null;
  display_order: number;
  is_active: boolean;
  icon_key: string | null;
}

/** Colonnes projetées. */
const OP_COLS =
  "id, bank_id, agency_id, service_id, code, name, sla_minutes, display_order, is_active, icon_key";

/**
 * Crée le routeur operations (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes operations (MODEL-API-A)
 */
export function createOperationRouter(): Hono<OperationEnv> {
  const router = new Hono<OperationEnv>();
  registerListOperations(router);
  registerCreateOperation(router);
  registerGetOperation(router);
  registerPatchOperation(router);
  registerDeleteOperation(router);
  return router;
}

/** Projette une ligne `operations` vers la ressource `Operation` de LA LOI. */
function toOperation(row: OperationRow): Record<string, unknown> {
  return {
    id: row.id,
    serviceId: row.service_id,
    code: row.code,
    name: row.name,
    slaMinutes: row.sla_minutes,
    displayOrder: row.display_order,
    isActive: row.is_active,
    ...(row.icon_key !== null ? { iconKey: row.icon_key } : {}),
  };
}

/** Ligne brute d'un service parent (scope bank + agency). */
interface ServiceParentRow {
  id: string;
  bank_id: string;
  agency_id: string;
}

/**
 * Charge un service parent du tenant, ou lève 404 SERVICE_NOT_FOUND.
 * Le service hors banque/hors agence → 404 opaque (jamais de fuite cross-tenant).
 */
async function loadServiceParent(
  db: Client,
  bankId: string,
  serviceId: string
): Promise<ServiceParentRow> {
  const res = await db.query(
    `SELECT id, bank_id, agency_id FROM services
      WHERE id=$1 AND bank_id=$2 AND deleted_at IS NULL`,
    [serviceId, bankId]
  );
  const row = res.rows[0] as ServiceParentRow | undefined;
  if (!row) throw new SigfaError("SERVICE_NOT_FOUND", "Service introuvable pour cet identifiant.", 404);
  return row;
}

/** Charge une opération du tenant, ou lève 404 OPERATION_NOT_FOUND. */
async function loadOperation(db: Client, bankId: string, id: string): Promise<OperationRow> {
  const res = await db.query(
    `SELECT ${OP_COLS} FROM operations WHERE id=$1 AND bank_id=$2`,
    [id, bankId]
  );
  const row = res.rows[0] as OperationRow | undefined;
  if (!row) throw new SigfaError("OPERATION_NOT_FOUND", "Opération introuvable pour cet identifiant.", 404);
  return row;
}

/** Enregistre GET /services/:serviceId/operations. */
function registerListOperations(router: Hono<OperationEnv>): void {
  router.get("/services/:serviceId/operations", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const serviceId = paramUuid(c, "serviceId");
      const service = await loadServiceParent(db, bankId, serviceId);
      assertAgencyScope(tenant, service.agency_id);
      const { page, limit, offset } = readPagination(c);
      const res = await db.query(
        `SELECT ${OP_COLS} FROM operations
          WHERE bank_id=$1 AND service_id=$2
          ORDER BY display_order ASC, created_at ASC LIMIT $3 OFFSET $4`,
        [bankId, serviceId, limit, offset]
      );
      const count = await db.query(
        `SELECT COUNT(*)::int AS total FROM operations WHERE bank_id=$1 AND service_id=$2`,
        [bankId, serviceId]
      );
      return c.json(
        {
          data: (res.rows as OperationRow[]).map(toOperation),
          meta: { page, limit, total: (count.rows[0] as { total: number }).total },
        },
        200
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre POST /services/:serviceId/operations + audit. */
function registerCreateOperation(router: Hono<OperationEnv>): void {
  router.post("/services/:serviceId/operations", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const serviceId = paramUuid(c, "serviceId");
      const service = await loadServiceParent(db, bankId, serviceId);
      assertAgencyScope(tenant, service.agency_id);
      const input = parseStrict(createOperationSchema, await parseJson(c));
      const created = await insertOperation(db, service, input);
      await recordAudit({
        db,
        tenant,
        action: "POST /services/:serviceId/operations",
        entityType: "operation",
        entityId: created.id,
        ip: extractIp(c),
        diff: buildDiff({}, { code: created.code, name: created.name, serviceId }),
      });
      return c.json(toOperation(created), 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Insère une opération, 409 si le code existe déjà dans le service. */
async function insertOperation(
  db: Client,
  service: ServiceParentRow,
  input: z.infer<typeof createOperationSchema>
): Promise<OperationRow> {
  const dup = await db.query(
    `SELECT 1 FROM operations WHERE service_id=$1 AND code=$2`,
    [service.id, input.code]
  );
  if (dup.rows.length > 0) {
    throw new SigfaError("OPERATION_CODE_DUPLICATE", "Une opération avec ce code existe déjà dans ce service.", 409, {
      code: input.code,
      serviceId: service.id,
    });
  }
  const res = await db.query(
    `INSERT INTO operations
       (bank_id, agency_id, service_id, code, name, sla_minutes, display_order, is_active, icon_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${OP_COLS}`,
    [
      service.bank_id,
      service.agency_id,
      service.id,
      input.code,
      input.name,
      input.slaMinutes ?? null,
      input.displayOrder,
      input.isActive ?? true,
      input.iconKey ?? null,
    ]
  );
  return res.rows[0] as OperationRow;
}

/** Enregistre GET /operations/:id. */
function registerGetOperation(router: Hono<OperationEnv>): void {
  router.get("/operations/:id", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const id = paramUuid(c, "id");
      const row = await loadOperation(db, bankId, id);
      assertAgencyScope(tenant, row.agency_id);
      return c.json(toOperation(row), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre PATCH /operations/:id (merge partiel) + audit. */
function registerPatchOperation(router: Hono<OperationEnv>): void {
  router.patch("/operations/:id", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      const bankId = requireBankId(tenant);
      const before = await loadOperation(db, bankId, id);
      assertAgencyScope(tenant, before.agency_id);
      const input = parseStrict(updateOperationSchema, await parseJson(c));
      await assertNoCodeDuplicate(db, before, input);
      const after = await updateOperation(db, bankId, id, input);
      await recordAudit({
        db,
        tenant,
        action: "PATCH /operations/:id",
        entityType: "operation",
        entityId: id,
        ip: extractIp(c),
        diff: buildDiff(
          { code: before.code, name: before.name, slaMinutes: before.sla_minutes, displayOrder: before.display_order, isActive: before.is_active, iconKey: before.icon_key },
          { code: after.code, name: after.name, slaMinutes: after.sla_minutes, displayOrder: after.display_order, isActive: after.is_active, iconKey: after.icon_key }
        ),
      });
      return c.json(toOperation(after), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** 409 OPERATION_CODE_DUPLICATE si le nouveau code entre en collision dans le service. */
async function assertNoCodeDuplicate(
  db: Client,
  before: OperationRow,
  input: z.infer<typeof updateOperationSchema>
): Promise<void> {
  if (input.code === undefined || input.code === before.code) return;
  const dup = await db.query(
    `SELECT 1 FROM operations WHERE service_id=$1 AND code=$2 AND id<>$3`,
    [before.service_id, input.code, before.id]
  );
  if (dup.rows.length > 0) {
    throw new SigfaError("OPERATION_CODE_DUPLICATE", "Une opération avec ce code existe déjà dans ce service.", 409, {
      code: input.code,
      serviceId: before.service_id,
    });
  }
}

/**
 * Applique un merge partiel. `slaMinutes`/`iconKey` : `null` explicite EFFACE
 * (re-hérite du service / retire l'icône), `undefined` (absent) CONSERVE.
 */
async function updateOperation(
  db: Client,
  bankId: string,
  id: string,
  input: z.infer<typeof updateOperationSchema>
): Promise<OperationRow> {
  const setSla = input.slaMinutes !== undefined;
  const setIcon = input.iconKey !== undefined;
  const res = await db.query(
    `UPDATE operations
        SET code = COALESCE($3, code),
            name = COALESCE($4, name),
            sla_minutes = CASE WHEN $5 THEN $6 ELSE sla_minutes END,
            display_order = COALESCE($7, display_order),
            is_active = COALESCE($8, is_active),
            icon_key = CASE WHEN $9 THEN $10 ELSE icon_key END,
            updated_at = NOW()
      WHERE id=$1 AND bank_id=$2
      RETURNING ${OP_COLS}`,
    [
      id,
      bankId,
      input.code ?? null,
      input.name ?? null,
      setSla,
      input.slaMinutes ?? null,
      input.displayOrder ?? null,
      input.isActive ?? null,
      setIcon,
      input.iconKey ?? null,
    ]
  );
  const row = res.rows[0] as OperationRow | undefined;
  if (!row) throw new SigfaError("OPERATION_NOT_FOUND", "Opération introuvable pour cet identifiant.", 404);
  return row;
}

/** Enregistre DELETE /operations/:id + audit. */
function registerDeleteOperation(router: Hono<OperationEnv>): void {
  router.delete("/operations/:id", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      const bankId = requireBankId(tenant);
      const before = await loadOperation(db, bankId, id);
      assertAgencyScope(tenant, before.agency_id);
      await db.query(`DELETE FROM operations WHERE id=$1 AND bank_id=$2`, [id, bankId]);
      await recordAudit({
        db,
        tenant,
        action: "DELETE /operations/:id",
        entityType: "operation",
        entityId: id,
        ip: extractIp(c),
        diff: buildDiff({ code: before.code, name: before.name }, {}),
      });
      return c.body(null, 204);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}
