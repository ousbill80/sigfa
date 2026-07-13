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
 * ## Sécurité (SEC-002-CUTOVER-LOT9) — route PLATEFORME (jamais armée)
 * `banks` est la table RACINE du tenant (elle EST la banque). Par conception DB-009
 * (`0001_rls.sql`), le rôle `sigfa_app` (NOBYPASSRLS) N'A AUCUN droit de mutation sur
 * `banks` : `REVOKE INSERT, UPDATE, DELETE ON banks FROM sigfa_app`. Seul le GRANT
 * colonne-scopé des 3 seuils + `updated_at` (0014/0015) est ouvert — réservé à
 * `thresholds.ts`. Donc :
 *  - POST /banks (INSERT) et PATCH /banks/:id (UPDATE name/is_active) sont
 *    STRUCTURELLEMENT impossibles sous une connexion armée `sigfa_app` (permission
 *    denied) : ce sont des opérations de GESTION DE BANQUE réservées à la connexion
 *    PLATEFORME (SUPER_ADMIN, RBAC `tenantScope: platform`). Les armer casserait.
 *  - GET /banks (liste cross-banques, SUPER_ADMIN platform) : la policy SELECT
 *    `tenant_isolation` de `banks` (USING id = current_bank_id) limiterait une liste
 *    armée à UNE seule banque — la liste réseau EXIGE la connexion plateforme.
 *  - GET/PATCH /banks/:id sont BANK_ADMIN (`tenantScope: bank`) mais opèrent sur la
 *    table racine dont les mutations sont plateforme-only ; l'accès est routé via
 *    `withPlatform` (frontière plateforme explicite) et la garde `id`/RBAC middleware
 *    borne le périmètre. Ce fichier est donc classé PLATFORM_OR_PUBLIC.
 *
 * @module
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { withPlatform } from "@sigfa/database";
import { SigfaError } from "src/lib/errors.js";
import { safeText } from "src/lib/safe-text.js";
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
    name: safeText().min(1),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    contactEmail: z.string().email().optional(),
  })
  .strict();

/** Corps de PATCH /banks/:id (LA LOI UpdateBankRequest). */
const updateBankSchema = z
  .object({
    name: safeText().min(1).optional(),
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
      // PLATEFORME : liste cross-banques (SUPER_ADMIN) — connexion plateforme, jamais
      // armée (une liste armée serait bornée à une seule banque par la RLS SELECT).
      const { res, total } = await withPlatform(
        (sql) => db.query(sql) as unknown as Promise<{ rows: Record<string, unknown>[] }>,
        async () => {
          const rows = await db.query(
            `SELECT id, name, slug, is_active, created_at
               FROM banks WHERE deleted_at IS NULL
              ORDER BY created_at ASC LIMIT $1 OFFSET $2`,
            [limit, offset]
          );
          const count = await db.query(
            `SELECT COUNT(*)::int AS total FROM banks WHERE deleted_at IS NULL`
          );
          return { res: rows, total: (count.rows[0] as { total: number }).total };
        }
      );
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
      // PLATEFORME : INSERT sur `banks` (révoqué pour sigfa_app) — connexion plateforme.
      const created = await withPlatform(
        (sql) => db.query(sql) as unknown as Promise<{ rows: Record<string, unknown>[] }>,
        () => insertBank(db, input)
      );
      await recordAudit({
        db,
        tenant: { ...tenant, bankId: created.id },
        action: "POST /banks",
        entityType: "bank",
        entityId: created.id,
        ip: extractIp(c),
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
      // PLATEFORME : lecture de la banque racine (RBAC middleware borne le périmètre).
      const bank = await withPlatform(
        (sql) => db.query(sql) as unknown as Promise<{ rows: Record<string, unknown>[] }>,
        () => loadBank(db, id)
      );
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
      // PLATEFORME : UPDATE name/is_active sur `banks` (colonnes révoquées pour
      // sigfa_app, DB-009) — opération de gestion de banque, connexion plateforme.
      const { before, after } = await withPlatform(
        (sql) => db.query(sql) as unknown as Promise<{ rows: Record<string, unknown>[] }>,
        async () => {
          const b = await loadBank(db, id);
          const a = await updateBank(db, id, input);
          return { before: b, after: a };
        }
      );
      await recordAudit({
        db,
        tenant,
        action: "PATCH /banks/:id",
        entityType: "bank",
        entityId: id,
        ip: extractIp(c),
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
