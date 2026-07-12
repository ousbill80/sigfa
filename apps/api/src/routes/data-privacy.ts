/**
 * Routes droit à l'oubli UEMOA — API-009 (admin.yaml).
 *
 * - POST /data/purge-phone       † — purge idempotente d'un numéro (BANK_ADMIN).
 *   1er appel → `{ purged: true, affectedTickets }` + entrée audit `DATA_PURGE`.
 *   2e appel → `{ purged: false, affectedTickets: 0 }` (idempotence LA LOI).
 *   En-tête `X-Idempotency-Key` OBLIGATOIRE (400 IDEMPOTENCY_KEY_REQUIRED sinon).
 * - GET  /data/retention-policy  — politique de rétention (défaut 13 mois).
 *
 * Réutilise `purgePhone` de @sigfa/database (branche DB-008) : la fonction
 * anonymise tickets + consentements ET écrit l'audit `DATA_PURGE` (sans PII).
 *
 * @module
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Client } from "pg";
import type { Redis } from "ioredis";
import { purgePhone, type QueryFn } from "@sigfa/database";
import { SigfaError } from "src/lib/errors.js";
import type { TenantContext } from "src/middleware/tenant.js";
import {
  errorResponse,
  parseJson,
  parseStrict,
  requireBankId,
} from "src/lib/admin-helpers.js";

/** Variables de contexte Hono du routeur data-privacy. */
interface DataPrivacyEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}

/** Durée de rétention par défaut (mois) — droit à l'oubli UEMOA. */
const DEFAULT_RETENTION_MONTHS = 13;

/** Corps de POST /data/purge-phone (LA LOI PurgePhoneRequest). */
const purgePhoneSchema = z
  .object({
    phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  })
  .strict();

/**
 * Crée le routeur data-privacy (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes droit à l'oubli API-009
 */
export function createDataPrivacyRouter(): Hono<DataPrivacyEnv> {
  const router = new Hono<DataPrivacyEnv>();
  registerPurgePhone(router);
  registerRetentionPolicy(router);
  return router;
}

/** Adapte `pg.Client` en `QueryFn` pour @sigfa/database. */
function toQueryFn(db: Client): QueryFn {
  return (sql: string) =>
    db.query(sql) as unknown as Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Enregistre POST /data/purge-phone (idempotent + audit DATA_PURGE). */
function registerPurgePhone(router: Hono<DataPrivacyEnv>): void {
  router.post("/data/purge-phone", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const idempotencyKey = c.req.header("X-Idempotency-Key");
      if (!idempotencyKey) {
        throw new SigfaError(
          "IDEMPOTENCY_KEY_REQUIRED",
          "L'en-tête X-Idempotency-Key est obligatoire pour cette mutation.",
          400
        );
      }
      const bankId = requireBankId(tenant);
      const input = parseStrict(purgePhoneSchema, await parseJson(c));
      const result = await purgePhone(toQueryFn(db), bankId, input.phone, {
        actorId: tenant.userId || null,
      });
      return c.json(
        { purged: result.purged, affectedTickets: result.affectedTickets },
        200
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre GET /data/retention-policy. */
function registerRetentionPolicy(router: Hono<DataPrivacyEnv>): void {
  router.get("/data/retention-policy", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const bankId = requireBankId(tenant);
      const months = await loadRetentionMonths(db, bankId);
      return c.json(
        {
          retentionMonths: months,
          description: `Les données personnelles des clients sont conservées ${months} mois après la dernière interaction.`,
          purgeSchedule: "daily",
          lastPurgeAt: null,
        },
        200
      );
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Lit la rétention de la banque (défaut 13 mois si aucune politique). */
async function loadRetentionMonths(db: Client, bankId: string): Promise<number> {
  const res = await db.query(
    `SELECT phone_retention_months FROM retention_policies WHERE bank_id = $1`,
    [bankId]
  );
  const row = res.rows[0] as { phone_retention_months: number } | undefined;
  return row?.phone_retention_months ?? DEFAULT_RETENTION_MONTHS;
}
