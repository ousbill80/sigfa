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
 * ## Sécurité (SEC-002-CUTOVER-LOT5)
 * TOUT accès DB tenant est routé via `withArmedTenant` (contexte RLS
 * `app.current_bank_id` armé sur la connexion `sigfa_app` NOBYPASSRLS) → cette route
 * est classée **ARMED** dans `tenant-armament-arch.test.ts`. L'effacement
 * (`purgePhone`) — UPDATE `tickets` (anonymisation), DELETE `notification_consents`
 * (PII pur) et INSERT `audit_log` — s'exécute dans UNE transaction armée sur le
 * `bankId` de l'appelant. Sous RLS FORCE, la policy `tenant_isolation` de chaque
 * table (0001/0003/0004) garantit que l'effacement ne PEUT toucher QUE les lignes de
 * la banque armée : l'effacement de A n'atteint jamais B, et B ne peut déclencher
 * l'effacement de A (armement toujours borné à `tenant.bankId`). La lecture de
 * rétention (`retention_policies`, policy `tenant_isolation`, 0006) partage la même
 * connexion armée.
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
} from "src/lib/admin-helpers.js";
import {
  withArmedTenant,
  asArmable,
  isCanonicalUuid,
  type ArmableConnection,
} from "src/lib/armed-tenant.js";

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

/**
 * Adapte une connexion armée (`ArmableConnection`) en `QueryFn` pour
 * @sigfa/database. `purgePhone` n'appelle `query` qu'avec un SQL littéral (aucun
 * paramètre lié) : l'adaptateur transmet la seule chaîne à la connexion armée, dont
 * toutes les requêtes héritent du contexte RLS `app.current_bank_id`.
 */
function toQueryFn(conn: ArmableConnection): QueryFn {
  return (sql: string) =>
    conn.query(sql) as unknown as Promise<{
      rows: Array<Record<string, unknown>>;
    }>;
}

/**
 * Exige un `bankId` tenant en UUID canonique pour l'armement RLS (SEC-002).
 * Absent (contexte plateforme) ou malformé → 403 : une route tenant ne s'arme
 * jamais sans banque résolue (le `bank_id` est interpolé dans `SET LOCAL`).
 *
 * @param tenant - Contexte tenant résolu
 * @throws {SigfaError} 403 FORBIDDEN si `bankId` absent/non-UUID
 */
function requireArmableBankId(tenant: TenantContext): string {
  const bankId = tenant.bankId;
  if (!bankId || !isCanonicalUuid(bankId)) {
    throw new SigfaError(
      "FORBIDDEN",
      "Contexte de banque requis pour cette opération.",
      403
    );
  }
  return bankId;
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
      const bankId = requireArmableBankId(tenant);
      const input = parseStrict(purgePhoneSchema, await parseJson(c));
      // SEC-002 : l'effacement (UPDATE tickets / DELETE consents / INSERT audit)
      // s'exécute dans UNE transaction ARMÉE. La policy `tenant_isolation` de
      // chaque table borne l'effacement à la banque armée — jamais un autre tenant.
      const result = await withArmedTenant(asArmable(db), bankId, (conn) =>
        purgePhone(toQueryFn(conn), bankId, input.phone, {
          actorId: tenant.userId || null,
        })
      );
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
      const bankId = requireArmableBankId(tenant);
      // SEC-002 : lecture de la rétention dans une transaction ARMÉE (RLS
      // `app.current_bank_id` — `retention_policies` isolée par tenant).
      const months = await withArmedTenant(asArmable(db), bankId, (conn) =>
        loadRetentionMonths(conn as unknown as Client, bankId)
      );
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
