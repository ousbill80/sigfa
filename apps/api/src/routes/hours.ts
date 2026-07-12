/**
 * Routes horaires d'agence — API-008 (admin.yaml).
 *
 * - GET   /agencies/:id/hours — horaires hebdo + fériés CI (lecture) + fermetures except.
 * - PATCH /agencies/:id/hours — merge partiel (AGENCY_DIRECTOR scope) + audit.
 *
 * Sémantique merge (critère EARS) :
 *   - `weeklySchedule` fourni : merge PAR JOUR dans l'hebdo existant (un jour non fourni
 *     est préservé) — jamais d'écrasement global.
 *   - `exceptionalClosures` fourni : REMPLACE la liste des fermetures exceptionnelles
 *     (contrat), sans jamais toucher l'hebdo.
 *   - Les fériés nationaux CI sont en LECTURE SEULE (référentiel `public_holidays`).
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
  assertAgencyScope,
} from "src/lib/admin-helpers.js";
import { recordAudit, buildDiff, extractIp } from "src/lib/audit-context.js";

/** Variables de contexte Hono du routeur horaires. */
interface HoursEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}


/** Jours de la semaine (LA LOI WeeklySchedule). */
const WEEKDAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

/** Schéma d'un jour (LA LOI DaySchedule, additionalProperties: false). */
const dayScheduleSchema = z
  .object({
    open: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
    close: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
    closed: z.boolean(),
  })
  .strict();

/** Schéma de l'hebdo (tous jours optionnels, additionalProperties: false). */
const weeklyScheduleSchema = z
  .object(Object.fromEntries(WEEKDAYS.map((d) => [d, dayScheduleSchema.optional()])))
  .strict();

/** Schéma d'une fermeture exceptionnelle (LA LOI ExceptionalClosure). */
const exceptionalClosureSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().max(200),
  })
  .strict();

/** Corps de PATCH /agencies/:id/hours (LA LOI UpdateAgencyHoursRequest). */
const updateHoursSchema = z
  .object({
    weeklySchedule: weeklyScheduleSchema.optional(),
    exceptionalClosures: z.array(exceptionalClosureSchema).optional(),
  })
  .strict();

/** Type d'un jour stocké (format admin). */
type DaySchedule = z.infer<typeof dayScheduleSchema>;
/** Hebdo stocké (jsonb). */
type WeeklySchedule = Partial<Record<(typeof WEEKDAYS)[number], DaySchedule>>;

/**
 * Crée le routeur horaires (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes horaires API-008
 */
export function createHoursRouter(): Hono<HoursEnv> {
  const router = new Hono<HoursEnv>();
  registerGetHours(router);
  registerPatchHours(router);
  return router;
}

/** Charge l'hebdo d'une agence du tenant, ou 404. */
async function loadWeekly(
  db: Client,
  bankId: string,
  agencyId: string
): Promise<WeeklySchedule> {
  const res = await db.query(
    `SELECT weekly_schedule FROM agencies
      WHERE id=$1 AND bank_id=$2 AND deleted_at IS NULL`,
    [agencyId, bankId]
  );
  const row = res.rows[0] as { weekly_schedule: WeeklySchedule } | undefined;
  if (!row) throw new SigfaError("NOT_FOUND", "Agence introuvable.", 404);
  return row.weekly_schedule ?? {};
}

/** Liste les fériés nationaux CI (lecture seule). */
async function loadPublicHolidays(
  db: Client
): Promise<Array<{ date: string; label: string }>> {
  const res = await db.query(
    `SELECT to_char(date,'YYYY-MM-DD') AS date, name FROM public_holidays ORDER BY date ASC`
  );
  return (res.rows as Array<{ date: string; name: string }>).map((r) => ({
    date: r.date,
    label: r.name,
  }));
}

/** Liste les fermetures exceptionnelles d'une agence. */
async function loadClosures(
  db: Client,
  bankId: string,
  agencyId: string
): Promise<Array<{ date: string; reason: string }>> {
  const res = await db.query(
    `SELECT to_char(date,'YYYY-MM-DD') AS date, reason FROM agency_exceptional_closures
      WHERE bank_id=$1 AND agency_id=$2 ORDER BY date ASC`,
    [bankId, agencyId]
  );
  return (res.rows as Array<{ date: string; reason: string | null }>).map((r) => ({
    date: r.date,
    reason: r.reason ?? "",
  }));
}

/** Compose la ressource AgencyHours de LA LOI. */
async function composeHours(
  db: Client,
  bankId: string,
  agencyId: string,
  weekly: WeeklySchedule
): Promise<Record<string, unknown>> {
  return {
    weeklySchedule: weekly,
    publicHolidaysCI: await loadPublicHolidays(db),
    exceptionalClosures: await loadClosures(db, bankId, agencyId),
  };
}

/** Enregistre GET /agencies/:id/hours. */
function registerGetHours(router: Hono<HoursEnv>): void {
  router.get("/agencies/:id/hours", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const agencyId = paramUuid(c, "id");
      assertAgencyScope(tenant, agencyId);
      const bankId = requireBankId(tenant);
      const weekly = await loadWeekly(db, bankId, agencyId);
      return c.json(await composeHours(db, bankId, agencyId, weekly), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre PATCH /agencies/:id/hours (merge) + audit. */
function registerPatchHours(router: Hono<HoursEnv>): void {
  router.patch("/agencies/:id/hours", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const agencyId = paramUuid(c, "id");
      assertAgencyScope(tenant, agencyId);
      const bankId = requireBankId(tenant);
      const input = parseStrict(updateHoursSchema, await parseJson(c));
      const before = await loadWeekly(db, bankId, agencyId);
      const merged = mergeWeekly(before, input.weeklySchedule);
      await persistHours(db, bankId, agencyId, merged, input.exceptionalClosures);
      await recordAudit({
        db, tenant,
        action: "PATCH /agencies/:id/hours",
        entityType: "agency_hours",
        entityId: agencyId,
        ip: extractIp((n) => c.req.header(n)),
        diff: buildDiff({ weeklySchedule: before }, { weeklySchedule: merged }),
      });
      return c.json(await composeHours(db, bankId, agencyId, merged), 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/**
 * Merge PAR JOUR l'hebdo : les jours fournis remplacent, les autres sont préservés.
 * Une fermeture exceptionnelle (weeklySchedule absent) ne touche donc jamais l'hebdo.
 *
 * @param existing - Hebdo courant
 * @param patch    - Jours fournis (optionnel)
 * @returns Hebdo mergé
 */
function mergeWeekly(
  existing: WeeklySchedule,
  patch?: WeeklySchedule
): WeeklySchedule {
  if (!patch) return existing;
  const merged: WeeklySchedule = { ...existing };
  for (const day of WEEKDAYS) {
    const value = patch[day];
    if (value !== undefined) merged[day] = value;
  }
  return merged;
}

/** Persiste l'hebdo mergé et, si fourni, remplace la liste des fermetures. */
async function persistHours(
  db: Client,
  bankId: string,
  agencyId: string,
  weekly: WeeklySchedule,
  closures?: Array<{ date: string; reason: string }>
): Promise<void> {
  await db.query(
    `UPDATE agencies SET weekly_schedule=$3::jsonb, updated_at=NOW()
      WHERE id=$1 AND bank_id=$2`,
    [agencyId, bankId, JSON.stringify(weekly)]
  );
  if (closures === undefined) return;
  await db.query(
    `DELETE FROM agency_exceptional_closures WHERE bank_id=$1 AND agency_id=$2`,
    [bankId, agencyId]
  );
  for (const closure of closures) {
    await db.query(
      `INSERT INTO agency_exceptional_closures (bank_id, agency_id, date, reason)
       VALUES ($1,$2,$3,$4)`,
      [bankId, agencyId, closure.date, closure.reason]
    );
  }
}
