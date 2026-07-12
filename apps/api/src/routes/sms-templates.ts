/**
 * Routes templates SMS de banque — API-008 (admin.yaml).
 *
 * - GET   /banks/:id/sms-templates — templates par type de notification.
 * - PATCH /banks/:id/sms-templates — upsert par type (BANK_ADMIN) + audit.
 *
 * Variables autorisées : `{{number}}`, `{{position}}`, `{{estimate}}`.
 * Toute autre variable → 422 `UNKNOWN_TEMPLATE_VARIABLE`.
 * Persistance dans `notification_templates` (canal SMS, langue FR).
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

/** Variables de contexte Hono du routeur templates SMS. */
interface SmsEnv {
  Variables: {
    db: Client;
    redis: Redis;
    jwtSecret: Uint8Array;
    tenant: TenantContext;
  };
}


/** Canal et langue par défaut des templates SMS admin. */
const SMS_CHANNEL = "SMS";
const SMS_LANG = "FR";

/** Variables autorisées dans un template (LA LOI). */
const ALLOWED_VARIABLES = ["{{number}}", "{{position}}", "{{estimate}}"] as const;

/** Types de notification valides (LA LOI NotificationType). */
const NOTIFICATION_TYPES = [
  "TICKET_CONFIRMATION", "POSITION_UPDATE", "YOUR_TURN", "DAILY_REPORT",
] as const;

/** Schéma d'un template (LA LOI SmsTemplate, additionalProperties: false). */
const smsTemplateSchema = z
  .object({
    type: z.enum(NOTIFICATION_TYPES),
    content: z.string().min(1).max(160),
  })
  .strict();

/** Corps de PATCH /banks/:id/sms-templates (LA LOI UpdateSmsTemplatesRequest). */
const updateSmsSchema = z
  .object({
    templates: z.array(smsTemplateSchema).min(1),
  })
  .strict();

/**
 * Crée le routeur templates SMS (monté sous /api/v1).
 *
 * @returns Routeur Hono des routes templates SMS API-008
 */
export function createSmsTemplateRouter(): Hono<SmsEnv> {
  const router = new Hono<SmsEnv>();
  registerGetTemplates(router);
  registerPatchTemplates(router);
  return router;
}

/** Extrait toutes les variables `{{...}}` d'un contenu. */
function extractVariables(content: string): string[] {
  return content.match(/\{\{[^}]*\}\}/g) ?? [];
}

/**
 * Valide qu'un contenu n'utilise que des variables autorisées.
 * @throws {SigfaError} 422 UNKNOWN_TEMPLATE_VARIABLE à la première variable inconnue.
 */
function assertKnownVariables(content: string): void {
  for (const variable of extractVariables(content)) {
    if (!ALLOWED_VARIABLES.includes(variable as (typeof ALLOWED_VARIABLES)[number])) {
      throw new SigfaError(
        "UNKNOWN_TEMPLATE_VARIABLE",
        `Variable inconnue '${variable}'. Variables autorisées : ${ALLOWED_VARIABLES.join(", ")}.`,
        422,
        { unknownVariable: variable, allowedVariables: [...ALLOWED_VARIABLES] }
      );
    }
  }
}

/** Charge les templates SMS d'une banque du tenant. */
async function loadTemplates(
  db: Client,
  bankId: string
): Promise<Array<{ type: string; content: string }>> {
  const res = await db.query(
    `SELECT type, body FROM notification_templates
      WHERE bank_id=$1 AND channel=$2::notification_channel AND lang=$3
      ORDER BY type ASC`,
    [bankId, SMS_CHANNEL, SMS_LANG]
  );
  return (res.rows as Array<{ type: string; body: string }>).map((r) => ({
    type: r.type,
    content: r.body,
  }));
}

/** Vérifie l'existence de la banque, ou 404. */
async function assertBankExists(db: Client, id: string): Promise<void> {
  const res = await db.query(
    `SELECT 1 FROM banks WHERE id=$1 AND deleted_at IS NULL`,
    [id]
  );
  if (res.rows.length === 0) {
    throw new SigfaError("NOT_FOUND", "Banque introuvable.", 404);
  }
}

/** Enregistre GET /banks/:id/sms-templates. */
function registerGetTemplates(router: Hono<SmsEnv>): void {
  router.get("/banks/:id/sms-templates", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      requireBankId(tenant);
      await assertBankExists(db, id);
      return c.json({ templates: await loadTemplates(db, id) }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Enregistre PATCH /banks/:id/sms-templates (upsert par type) + audit. */
function registerPatchTemplates(router: Hono<SmsEnv>): void {
  router.patch("/banks/:id/sms-templates", async (c) => {
    const db = c.get("db");
    const tenant = c.get("tenant");
    try {
      const id = paramUuid(c, "id");
      requireBankId(tenant);
      await assertBankExists(db, id);
      const input = parseStrict(updateSmsSchema, await parseJson(c));
      for (const template of input.templates) assertKnownVariables(template.content);
      const before = await loadTemplates(db, id);
      for (const template of input.templates) {
        await upsertTemplate(db, id, template);
      }
      const after = await loadTemplates(db, id);
      await recordAudit({
        db, tenant,
        action: "PATCH /banks/:id/sms-templates",
        entityType: "sms_templates",
        entityId: id,
        ip: extractIp((n) => c.req.header(n)),
        diff: buildDiff({ templates: before }, { templates: after }),
      });
      return c.json({ templates: after }, 200);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}

/** Upsert d'un template (type, canal SMS, langue FR). */
async function upsertTemplate(
  db: Client,
  bankId: string,
  template: z.infer<typeof smsTemplateSchema>
): Promise<void> {
  await db.query(
    `INSERT INTO notification_templates (bank_id, type, channel, lang, body)
     VALUES ($1, $2::notification_type, $3::notification_channel, $4, $5)
     ON CONFLICT (bank_id, type, channel, lang)
     DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()`,
    [bankId, template.type, SMS_CHANNEL, SMS_LANG, template.content]
  );
}
