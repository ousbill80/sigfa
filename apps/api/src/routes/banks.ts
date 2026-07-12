/**
 * Routes banques — API-008 (core.yaml).
 *
 * - GET  /banks       — liste paginée (platform, SUPER_ADMIN).
 * - POST /banks       — création (platform, SUPER_ADMIN) + audit.
 * - GET  /banks/:id   — détail (bank, BANK_ADMIN scope tenant).
 * - PATCH /banks/:id  — mise à jour partielle (name/active) + audit.
 *
 * Sémantique PATCH : merge partiel — seuls les champs fournis sont modifiés
 * (COALESCE), les autres colonnes (slug, thème, seuils) sont préservées.
 *
 * @module
 */

import { Hono } from "hono";
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
} from "src/lib/admin-helpers.js";
import { recordAudit, buildDiff, extractIp } from "src/lib/audit-context.js";

/** Variables de contexte Hono du routeur banques. */
interface BankEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}


/** Corps de POST /banks (LA LOI CreateBankRequest, additionalProperties: false). */
const createBankSchema = z
  .object({
    name: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    contactEmail: z.string().email().optional(),
  })
  .strict();

/** Corps de PATCH /banks/:id (LA LOI UpdateBankRequest). */
const updateBankSchema = z
  .object({
    name: z.string().min(1).optional(),
    active: z.boolean().optional(),
  })
  .strict();

/** Ligne brute de la table `banks` (colonnes projetées). */
interface BankRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: Date;
}

/**
 * Crée le routeur banques (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes banques API-008
 */
export function createBankRouter(): Hono<BankEnv> {
  const router = new Hono<BankEnv>();
  registerListBanks(router);
  registerCreateBank(router);
  registerGetBank(router);
  registerPatchBank(router);
  return router;
}

/** Projette une ligne `banks` vers la ressource `Bank` de LA LOI. */
function toBank(row: BankRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    active: row.is_active,
    createdAt: row.created_at.toISOString(),
  };
}

/** Enregistre GET /banks (platform). */
function registerListBanks(router: Hono<BankEnv>): void {
  router.get("/banks", async (c) => {
    const db = c.get("db");
    try {
      const { page, limit, offset } = readPagination(c);
      const res = await db.query(
        `SELECT id, name, slug, is_active, created_at
           FROM banks WHERE deleted_at IS NULL
          ORDER BY created_at ASC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      const count = await db.query(
        `SELECT COUNT(*)::int AS total FROM banks WHERE deleted_at IS NULL`
      );
      const total = (count.rows[0] as { total: number }).total;
      return c.json(
        {
          data: (res.rows as BankRow[]).map(toBank),
          meta: { page, limit, total },
        },
        200
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre POST /banks (platform) + audit. */
function registerCreateBank(router: Hono<BankEnv>): void {
  router.post("/banks", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const input = parseStrict(createBankSchema, await parseJson(c));
      const created = await insertBank(db, input);
      await recordAudit({
        db,
        tenant: { ...tenant, bankId: created.id },
        action: "POST /banks",
        entityType: "bank",
        entityId: created.id,
        ip: extractIp((n) => c.req.header(n)),
        diff: buildDiff({}, { name: created.name, slug: created.slug }),
      });
      return c.json(toBank(created), 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Insère une banque, 409 si le slug existe déjà. */
async function insertBank(
  db: Client,
  input: z.infer<typeof createBankSchema>
): Promise<BankRow> {
  const dup = await db.query(`SELECT 1 FROM banks WHERE slug = $1`, [
    input.slug,
  ]);
  if (dup.rows.length > 0) {
    throw new SigfaError("CONFLICT", "Slug de banque déjà utilisé.", 409);
  }
  const res = await db.query(
    `INSERT INTO banks (name, slug)
     VALUES ($1, $2)
     RETURNING id, name, slug, is_active, created_at`,
    [input.name, input.slug]
  );
  return res.rows[0] as BankRow;
}

/** Enregistre GET /banks/:id (bank scope). */
function registerGetBank(router: Hono<BankEnv>): void {
  router.get("/banks/:id", async (c) => {
    const db = c.get("db");
    try {
      const id = paramUuid(c, "id");
      const bank = await loadBank(db, id);
      return c.json(toBank(bank), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Charge une banque non supprimée, ou 404. */
async function loadBank(db: Client, id: string): Promise<BankRow> {
  const res = await db.query(
    `SELECT id, name, slug, is_active, created_at
       FROM banks WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const row = res.rows[0] as BankRow | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Banque introuvable.", 404);
  return row;
}

/** Enregistre PATCH /banks/:id (merge partiel) + audit. */
function registerPatchBank(router: Hono<BankEnv>): void {
  router.patch("/banks/:id", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      const input = parseStrict(updateBankSchema, await parseJson(c));
      const before = await loadBank(db, id);
      const after = await updateBank(db, id, input);
      await recordAudit({
        db,
        tenant,
        action: "PATCH /banks/:id",
        entityType: "bank",
        entityId: id,
        ip: extractIp((n) => c.req.header(n)),
        diff: buildDiff(
          { name: before.name, active: before.is_active },
          { name: after.name, active: after.is_active }
        ),
      });
      return c.json(toBank(after), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Applique un merge partiel (name/active) et retourne la banque à jour. */
async function updateBank(
  db: Client,
  id: string,
  input: z.infer<typeof updateBankSchema>
): Promise<BankRow> {
  const res = await db.query(
    `UPDATE banks
        SET name = COALESCE($2, name),
            is_active = COALESCE($3, is_active),
            updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, name, slug, is_active, created_at`,
    [id, input.name ?? null, input.active ?? null]
  );
  const row = res.rows[0] as BankRow | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Banque introuvable.", 404);
  return row;
}
