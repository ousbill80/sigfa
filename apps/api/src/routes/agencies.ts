/**
 * Routes agences — API-008 (core.yaml).
 *
 * - GET   /agencies      — liste des agences de la banque (bank, BANK_ADMIN).
 * - POST  /agencies      — création rattachée à la banque (bank, BANK_ADMIN) + audit.
 * - GET   /agencies/:id  — détail (agency, AGENCY_DIRECTOR scope).
 * - PATCH /agencies/:id  — merge partiel (agency, AGENCY_DIRECTOR scope) + audit.
 * - DELETE /agencies/:id — soft-delete (bank, BANK_ADMIN) : 409 AGENCY_HAS_OPEN_TICKETS
 *   si des tickets ouverts existent, sinon désactivation + invisibilité des listes.
 *
 * Les agences soft-supprimées (`deleted_at IS NOT NULL`) sont filtrées partout.
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

/** Variables de contexte Hono du routeur agences. */
interface AgencyEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}


/** États de ticket considérés « ouverts » (bloquent la suppression d'agence). */
const OPEN_TICKET_STATUSES = ["WAITING", "CALLED", "SERVING"] as const;

/** Corps de POST /agencies (LA LOI CreateAgencyRequest). */
const createAgencySchema = z
  .object({
    name: safeText().min(1),
    address: safeText().optional(),
    phone: safeText().optional(),
    timezone: safeText().optional(),
  })
  .strict();

/** Corps de PATCH /agencies/:id (LA LOI UpdateAgencyRequest). */
const updateAgencySchema = z
  .object({
    name: safeText().min(1).optional(),
    active: z.boolean().optional(),
    address: safeText().optional(),
    phone: safeText().optional(),
  })
  .strict();

/** Ligne brute de la table `agencies` (colonnes projetées). */
interface AgencyRow {
  id: string;
  bank_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  is_active: boolean;
  created_at: Date;
}

/**
 * Crée le routeur agences (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes agences API-008
 */
export function createAgencyRouter(): Hono<AgencyEnv> {
  const router = new Hono<AgencyEnv>();
  registerListAgencies(router);
  registerCreateAgency(router);
  registerGetAgency(router);
  registerPatchAgency(router);
  registerDeleteAgency(router);
  return router;
}

/** Projette une ligne `agencies` vers la ressource `Agency` de LA LOI. */
function toAgency(row: AgencyRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    bankId: row.bank_id,
    active: row.is_active,
    ...(row.address ? { address: row.address } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    timezone: row.timezone,
    createdAt: row.created_at.toISOString(),
  };
}

/** Colonnes projetées pour une agence. */
const AGENCY_COLS =
  "id, bank_id, name, address, phone, timezone, is_active, created_at";

/** Enregistre GET /agencies (liste, filtre soft-delete). */
function registerListAgencies(router: Hono<AgencyEnv>): void {
  router.get("/agencies", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const { page, limit, offset } = readPagination(c);
      const res = await db.query(
        `SELECT ${AGENCY_COLS} FROM agencies
          WHERE bank_id = $1 AND deleted_at IS NULL
          ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
        [bankId, limit, offset]
      );
      const count = await db.query(
        `SELECT COUNT(*)::int AS total FROM agencies
          WHERE bank_id = $1 AND deleted_at IS NULL`,
        [bankId]
      );
      return c.json(
        {
          data: (res.rows as AgencyRow[]).map(toAgency),
          meta: { page, limit, total: (count.rows[0] as { total: number }).total },
        },
        200
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre POST /agencies + audit. */
function registerCreateAgency(router: Hono<AgencyEnv>): void {
  router.post("/agencies", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const input = parseStrict(createAgencySchema, await parseJson(c));
      const created = await insertAgency(db, bankId, input);
      await recordAudit({
        db,
        tenant,
        action: "POST /agencies",
        entityType: "agency",
        entityId: created.id,
        ip: extractIp(c),
        diff: buildDiff({}, { name: created.name }),
      });
      return c.json(toAgency(created), 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Insère une agence rattachée à la banque. */
async function insertAgency(
  db: Client,
  bankId: string,
  input: z.infer<typeof createAgencySchema>
): Promise<AgencyRow> {
  const res = await db.query(
    `INSERT INTO agencies (bank_id, name, address, phone, timezone)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'Africa/Abidjan'))
     RETURNING ${AGENCY_COLS}`,
    [bankId, input.name, input.address ?? null, input.phone ?? null, input.timezone ?? null]
  );
  return res.rows[0] as AgencyRow;
}

/** Charge une agence non supprimée du tenant, ou 404. */
async function loadAgency(
  db: Client,
  bankId: string,
  id: string
): Promise<AgencyRow> {
  const res = await db.query(
    `SELECT ${AGENCY_COLS} FROM agencies
      WHERE id = $1 AND bank_id = $2 AND deleted_at IS NULL`,
    [id, bankId]
  );
  const row = res.rows[0] as AgencyRow | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Agence introuvable.", 404);
  return row;
}

/** Enregistre GET /agencies/:id (scope agence). */
function registerGetAgency(router: Hono<AgencyEnv>): void {
  router.get("/agencies/:id", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      assertAgencyScope(tenant, id);
      const agency = await loadAgency(db, requireBankId(tenant), id);
      return c.json(toAgency(agency), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre PATCH /agencies/:id (merge partiel) + audit. */
function registerPatchAgency(router: Hono<AgencyEnv>): void {
  router.patch("/agencies/:id", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      assertAgencyScope(tenant, id);
      const bankId = requireBankId(tenant);
      const input = parseStrict(updateAgencySchema, await parseJson(c));
      const before = await loadAgency(db, bankId, id);
      const after = await updateAgency(db, bankId, id, input);
      await recordAudit({
        db,
        tenant,
        action: "PATCH /agencies/:id",
        entityType: "agency",
        entityId: id,
        ip: extractIp(c),
        diff: buildDiff(
          { name: before.name, active: before.is_active, address: before.address, phone: before.phone },
          { name: after.name, active: after.is_active, address: after.address, phone: after.phone }
        ),
      });
      return c.json(toAgency(after), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Applique un merge partiel sur une agence. */
async function updateAgency(
  db: Client,
  bankId: string,
  id: string,
  input: z.infer<typeof updateAgencySchema>
): Promise<AgencyRow> {
  const res = await db.query(
    `UPDATE agencies
        SET name = COALESCE($3, name),
            is_active = COALESCE($4, is_active),
            address = COALESCE($5, address),
            phone = COALESCE($6, phone),
            updated_at = NOW()
      WHERE id = $1 AND bank_id = $2 AND deleted_at IS NULL
      RETURNING ${AGENCY_COLS}`,
    [id, bankId, input.name ?? null, input.active ?? null, input.address ?? null, input.phone ?? null]
  );
  const row = res.rows[0] as AgencyRow | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Agence introuvable.", 404);
  return row;
}

/** Enregistre DELETE /agencies/:id (soft-delete + garde tickets ouverts). */
function registerDeleteAgency(router: Hono<AgencyEnv>): void {
  router.delete("/agencies/:id", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      const bankId = requireBankId(tenant);
      await loadAgency(db, bankId, id);
      await assertNoOpenTickets(db, bankId, id);
      await db.query(
        `UPDATE agencies SET deleted_at = NOW(), is_active = false, updated_at = NOW()
          WHERE id = $1 AND bank_id = $2`,
        [id, bankId]
      );
      await recordAudit({
        db,
        tenant,
        action: "DELETE /agencies/:id",
        entityType: "agency",
        entityId: id,
        ip: extractIp(c),
        diff: buildDiff({ deleted: false }, { deleted: true }),
      });
      return c.json({ success: true }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/**
 * Vérifie qu'aucun ticket ouvert (WAITING/CALLED/SERVING) n'est rattaché à l'agence.
 *
 * @throws {SigfaError} 409 AGENCY_HAS_OPEN_TICKETS si des tickets ouverts existent.
 */
async function assertNoOpenTickets(
  db: Client,
  bankId: string,
  agencyId: string
): Promise<void> {
  const res = await db.query(
    `SELECT 1 FROM tickets
      WHERE agency_id = $1 AND bank_id = $2 AND status = ANY($3::ticket_status[])
      LIMIT 1`,
    [agencyId, bankId, [...OPEN_TICKET_STATUSES]]
  );
  if (res.rows.length > 0) {
    throw new SigfaError(
      "AGENCY_HAS_OPEN_TICKETS",
      "Impossible de supprimer une agence avec des tickets ouverts.",
      409
    );
  }
}
