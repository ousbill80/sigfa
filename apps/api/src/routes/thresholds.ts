/**
 * Routes seuils de banque — API-008 (admin.yaml).
 *
 * - GET   /banks/:id/thresholds — seuils file critique / inactivité / no-show.
 * - PATCH /banks/:id/thresholds — merge partiel borné (BANK_ADMIN) + audit.
 *
 * Bornes LA LOI (additionalProperties: false, min/max) :
 *   queueCriticalThreshold 1..500 · agentInactivityMinutes 1..60 · noShowTimeoutMinutes 1..30.
 * Un PATCH thresholds ne touche JAMAIS les horaires ni le thème.
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
  requireBankId,
} from "src/lib/admin-helpers.js";
import { recordAudit, buildDiff, extractIp } from "src/lib/audit-context.js";

/** Variables de contexte Hono du routeur seuils. */
interface ThresholdsEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}


/** Corps de PATCH /banks/:id/thresholds (LA LOI UpdateBankThresholdsRequest). */
const updateThresholdsSchema = z
  .object({
    queueCriticalThreshold: z.number().int().min(1).max(500).optional(),
    agentInactivityMinutes: z.number().int().min(1).max(60).optional(),
    noShowTimeoutMinutes: z.number().int().min(1).max(30).optional(),
  })
  .strict();

/** Ligne brute des seuils. */
interface ThresholdsRow {
  queue_critical_threshold: number;
  agent_inactivity_minutes: number;
  no_show_timeout_minutes: number;
}

/**
 * Crée le routeur seuils (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes seuils API-008
 */
export function createThresholdsRouter(): Hono<ThresholdsEnv> {
  const router = new Hono<ThresholdsEnv>();
  registerGetThresholds(router);
  registerPatchThresholds(router);
  return router;
}

/** Projette une ligne de seuils vers la ressource BankThresholds. */
function toThresholds(row: ThresholdsRow): Record<string, unknown> {
  return {
    queueCriticalThreshold: row.queue_critical_threshold,
    agentInactivityMinutes: row.agent_inactivity_minutes,
    noShowTimeoutMinutes: row.no_show_timeout_minutes,
  };
}

/** Charge les seuils d'une banque du tenant, ou 404. */
async function loadThresholds(db: Client, id: string): Promise<ThresholdsRow> {
  const res = await db.query(
    `SELECT queue_critical_threshold, agent_inactivity_minutes, no_show_timeout_minutes
       FROM banks WHERE id=$1 AND deleted_at IS NULL`,
    [id]
  );
  const row = res.rows[0] as ThresholdsRow | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Banque introuvable.", 404);
  return row;
}

/** Enregistre GET /banks/:id/thresholds. */
function registerGetThresholds(router: Hono<ThresholdsEnv>): void {
  router.get("/banks/:id/thresholds", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      requireBankId(tenant);
      return c.json(toThresholds(await loadThresholds(db, id)), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre PATCH /banks/:id/thresholds (merge borné) + audit. */
function registerPatchThresholds(router: Hono<ThresholdsEnv>): void {
  router.patch("/banks/:id/thresholds", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      requireBankId(tenant);
      const input = parseStrict(updateThresholdsSchema, await parseJson(c));
      const before = await loadThresholds(db, id);
      const after = await updateThresholds(db, id, input);
      await recordAudit({
        db, tenant,
        action: "PATCH /banks/:id/thresholds",
        entityType: "bank_thresholds",
        entityId: id,
        ip: extractIp(c),
        diff: buildDiff(toThresholds(before), toThresholds(after)),
      });
      return c.json(toThresholds(after), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Applique un merge partiel borné des seuils. */
async function updateThresholds(
  db: Client,
  id: string,
  input: z.infer<typeof updateThresholdsSchema>
): Promise<ThresholdsRow> {
  const res = await db.query(
    `UPDATE banks
        SET queue_critical_threshold = COALESCE($2, queue_critical_threshold),
            agent_inactivity_minutes = COALESCE($3, agent_inactivity_minutes),
            no_show_timeout_minutes = COALESCE($4, no_show_timeout_minutes),
            updated_at = NOW()
      WHERE id=$1 AND deleted_at IS NULL
      RETURNING queue_critical_threshold, agent_inactivity_minutes, no_show_timeout_minutes`,
    [id, input.queueCriticalThreshold ?? null, input.agentInactivityMinutes ?? null, input.noShowTimeoutMinutes ?? null]
  );
  const row = res.rows[0] as ThresholdsRow | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Banque introuvable.", 404);
  return row;
}
